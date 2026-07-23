package com.hybridengine.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.view.WindowManager;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * THE Hybrid Engine — native Android shell.
 *
 * A thin, dark WebView around the live PWA plus a native BLE bridge
 * (window.AndroidHR) so the Conditioning screen gets real second-by-second
 * heart rate from WHOOP's HR Broadcast — something no TWA/WebView exposes
 * through Web Bluetooth. The web app remains the product and keeps updating
 * over the air; this shell only does what the web platform can't.
 *
 * JS contract (all optional-guarded in app.js):
 *   AndroidHR.startScan()          — scan + connect, then stream samples
 *   AndroidHR.stop()               — drop the connection
 *   AndroidHR.keepAwake(boolean)   — hold the screen on during sessions
 *   AndroidHR.saveFile(name, text) — export a backup via system file picker
 * Callbacks into the page:
 *   conNativeSample(bpm)
 *   conNativeState('scanning'|'connected'|'reconnecting'|'lost'|'error', msg)
 */
public class MainActivity extends Activity {

  private static final String APP_URL = "https://thehybridengine1.netlify.app/";
  private static final String HOST = "thehybridengine1.netlify.app";
  private static final UUID HR_SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb");
  private static final UUID HR_MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");
  private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

  private static final int REQ_PERMS = 1;
  private static final int REQ_FILE = 2;
  private static final int REQ_EXPORT = 3;
  private static final int REQ_BT_ON = 4;
  private static final int REQ_OCR = 5;
  private static final long SCAN_MS = 6000;
  private static final int MAX_RECONNECTS = 5;

  private WebView web;
  private final Handler main = new Handler(Looper.getMainLooper());

  // BLE state
  private BluetoothAdapter btAdapter;
  private BluetoothLeScanner scanner;
  private ScanCallback scanCb;
  private final Map<String, BluetoothDevice> found = new LinkedHashMap<>();
  private BluetoothDevice device;
  private BluetoothGatt gatt;
  private boolean wantHr = false;      // true while a session wants the stream
  private boolean scanning = false;
  private int reconnects = 0;

  // pending async bits
  private boolean pendingScan = false;
  private ValueCallback<Uri[]> fileCallback;
  private String pendingExport;

  @SuppressLint("SetJavaScriptEnabled")
  @Override protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    web = new WebView(this);
    setContentView(web);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setMediaPlaybackRequiresUserGesture(true);
    web.setBackgroundColor(0xFF080808);

    CookieManager cm = CookieManager.getInstance();
    cm.setAcceptCookie(true);
    cm.setAcceptThirdPartyCookies(web, true);

    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
        Uri u = req.getUrl();
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        if (scheme.equals("http") || scheme.equals("https")) return false; // stay in-app (OAuth needs this)
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
        return true;
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = cb;
        try {
          Intent i = new Intent(Intent.ACTION_GET_CONTENT);
          i.addCategory(Intent.CATEGORY_OPENABLE);
          i.setType("*/*");
          // Honor the page's accept= list (backup import wants JSON, the
          // workout-photo importer wants images) instead of hardcoding.
          String[] accept = params == null ? null : params.getAcceptTypes();
          if (accept != null && accept.length > 0 && accept[0] != null && !accept[0].trim().isEmpty()) {
            java.util.List<String> mimes = new java.util.ArrayList<>();
            for (String a : accept) {
              if (a == null) continue;
              a = a.trim();
              if (a.isEmpty()) continue;
              if (a.startsWith(".")) { // extension → best-effort mime
                if (a.equals(".json")) mimes.add("application/json");
                else if (a.equals(".txt")) mimes.add("text/plain");
              } else mimes.add(a);
            }
            if (mimes.size() == 1) i.setType(mimes.get(0));
            else if (!mimes.isEmpty()) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
          }
          startActivityForResult(Intent.createChooser(i, "Choose file"), REQ_FILE);
        } catch (Exception e) { fileCallback = null; return false; }
        return true;
      }
    });

    web.addJavascriptInterface(new HrBridge(), "AndroidHR");
    web.addJavascriptInterface(new OcrBridge(), "AndroidOCR");

    BluetoothManager bm = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
    if (bm != null) btAdapter = bm.getAdapter();

    Uri deep = getIntent() == null ? null : getIntent().getData();
    web.loadUrl(deep != null && HOST.equals(deep.getHost()) ? deep.toString() : APP_URL);
  }

  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    Uri deep = intent.getData();
    if (deep != null && HOST.equals(deep.getHost())) web.loadUrl(deep.toString());
  }

  @Override public void onBackPressed() {
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }

  @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }

  @Override protected void onDestroy() { closeGatt(); super.onDestroy(); }

  /* ---------- the JS bridge ---------- */

  private class HrBridge {
    @JavascriptInterface public void startScan() { main.post(MainActivity.this::beginScanFlow); }
    @JavascriptInterface public void stop() { main.post(() -> { wantHr = false; stopScan(); closeGatt(); }); }
    @JavascriptInterface public void keepAwake(final boolean on) {
      main.post(() -> {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      });
    }
    @JavascriptInterface public void saveFile(final String name, final String content) {
      main.post(() -> {
        pendingExport = content;
        try {
          Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
          i.addCategory(Intent.CATEGORY_OPENABLE);
          i.setType("application/json");
          i.putExtra(Intent.EXTRA_TITLE, name == null ? "backup.json" : name);
          startActivityForResult(i, REQ_EXPORT);
        } catch (Exception e) { pendingExport = null; toast("Could not open the file saver."); }
      });
    }
  }

  /**
   * On-device photo OCR via ML Kit (bundled model — free, offline, the
   * photo never leaves the phone). The page calls AndroidOCR.scan(); we
   * open the system photo picker, run text recognition, and hand the text
   * back through impNativeOcr()/impNativeOcrErr().
   */
  private class OcrBridge {
    @JavascriptInterface public void scan() {
      main.post(() -> {
        try {
          Intent i = new Intent(Intent.ACTION_GET_CONTENT);
          i.addCategory(Intent.CATEGORY_OPENABLE);
          i.setType("image/*");
          startActivityForResult(Intent.createChooser(i, "Choose photo"), REQ_OCR);
        } catch (Exception e) {
          js("typeof impNativeOcrErr==='function'&&impNativeOcrErr(" + JSONObject.quote("Could not open the photo picker.") + ")");
        }
      });
    }
  }

  private void runOcr(Uri uri) {
    js("typeof impNativeOcrBusy==='function'&&impNativeOcrBusy()");
    try {
      com.google.mlkit.vision.common.InputImage img =
          com.google.mlkit.vision.common.InputImage.fromFilePath(this, uri);
      com.google.mlkit.vision.text.TextRecognition.getClient(
              com.google.mlkit.vision.text.latin.TextRecognizerOptions.DEFAULT_OPTIONS)
          .process(img)
          .addOnSuccessListener(t ->
              js("typeof impNativeOcr==='function'&&impNativeOcr(" + JSONObject.quote(t.getText() == null ? "" : t.getText()) + ")"))
          .addOnFailureListener(e ->
              js("typeof impNativeOcrErr==='function'&&impNativeOcrErr(" + JSONObject.quote(String.valueOf(e.getMessage())) + ")"));
    } catch (Exception e) {
      js("typeof impNativeOcrErr==='function'&&impNativeOcrErr(" + JSONObject.quote("Could not read that image.") + ")");
    }
  }

  private void js(String call) { main.post(() -> web.evaluateJavascript(call, null)); }
  private void state(String st, String msg) {
    js("typeof conNativeState==='function'&&conNativeState(" + JSONObject.quote(st) + "," + JSONObject.quote(msg == null ? "" : msg) + ")");
  }
  private void toast(String t) { main.post(() -> Toast.makeText(this, t, Toast.LENGTH_SHORT).show()); }

  /* ---------- permissions / adapter gating ---------- */

  private String[] neededPerms() {
    if (Build.VERSION.SDK_INT >= 31)
      return new String[]{android.Manifest.permission.BLUETOOTH_SCAN, android.Manifest.permission.BLUETOOTH_CONNECT};
    return new String[]{android.Manifest.permission.ACCESS_FINE_LOCATION};
  }
  private boolean hasPerms() {
    for (String p : neededPerms())
      if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
    return true;
  }

  private void beginScanFlow() {
    if (btAdapter == null) { state("error", "This device has no Bluetooth."); return; }
    if (!hasPerms()) { pendingScan = true; requestPermissions(neededPerms(), REQ_PERMS); return; }
    if (!btAdapter.isEnabled()) {
      pendingScan = true;
      try { startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQ_BT_ON); }
      catch (SecurityException e) { pendingScan = false; state("error", "Bluetooth permission was refused."); }
      return;
    }
    startScan();
  }

  @Override public void onRequestPermissionsResult(int code, String[] perms, int[] grants) {
    if (code != REQ_PERMS) return;
    if (hasPerms()) { if (pendingScan) { pendingScan = false; beginScanFlow(); } }
    else { pendingScan = false; state("error", "Bluetooth permission was refused — allow it to read your WHOOP."); }
  }

  /* ---------- scanning ---------- */

  private void startScan() {
    if (scanning) return;
    try {
      scanner = btAdapter.getBluetoothLeScanner();
      if (scanner == null) { state("error", "Turn on Bluetooth and try again."); return; }
      found.clear();
      scanning = true;
      state("scanning", "");
      ScanFilter f = new ScanFilter.Builder().setServiceUuid(new ParcelUuid(HR_SERVICE)).build();
      ScanSettings st = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
      scanCb = new ScanCallback() {
        @Override public void onScanResult(int cbType, ScanResult r) {
          BluetoothDevice d = r.getDevice();
          if (d == null) return;
          String name = safeName(d);
          found.put(d.getAddress(), d);
          // WHOOP bands announce as "WHOOP ..." — connect straight away.
          if (name != null && name.toUpperCase().startsWith("WHOOP")) {
            main.post(() -> { if (scanning) { stopScan(); connectTo(d); } });
          }
        }
        @Override public void onScanFailed(int errorCode) {
          main.post(() -> { scanning = false; state("error", "Bluetooth scan failed (" + errorCode + ")."); });
        }
      };
      scanner.startScan(java.util.Collections.singletonList(f), st, scanCb);
      main.postDelayed(this::scanWindowOver, SCAN_MS);
    } catch (SecurityException e) {
      scanning = false; state("error", "Bluetooth permission was refused.");
    }
  }

  private void scanWindowOver() {
    if (!scanning) return;
    stopScan();
    if (found.isEmpty()) {
      state("error", "No heart-rate broadcast found. In the WHOOP app: Device Settings → HR Broadcast ON, then try again.");
      return;
    }
    List<BluetoothDevice> devs = new ArrayList<>(found.values());
    if (devs.size() == 1) { connectTo(devs.get(0)); return; }
    String[] names = new String[devs.size()];
    for (int i = 0; i < devs.size(); i++) {
      String n = safeName(devs.get(i));
      names[i] = (n == null || n.isEmpty()) ? devs.get(i).getAddress() : n;
    }
    new AlertDialog.Builder(this)
        .setTitle("Choose heart-rate source")
        .setItems(names, (d, which) -> connectTo(devs.get(which)))
        .setNegativeButton("Cancel", (d, w) -> state("error", "Connection cancelled."))
        .setOnCancelListener(d -> state("error", "Connection cancelled."))
        .show();
  }

  private void stopScan() {
    scanning = false;
    try { if (scanner != null && scanCb != null) scanner.stopScan(scanCb); } catch (Exception ignored) {}
    scanCb = null;
  }

  private String safeName(BluetoothDevice d) {
    try { return d.getName(); } catch (SecurityException e) { return null; }
  }

  /* ---------- GATT ---------- */

  private void connectTo(BluetoothDevice d) {
    device = d;
    wantHr = true;
    reconnects = 0;
    openGatt();
  }

  private void openGatt() {
    closeGatt();
    try {
      gatt = device.connectGatt(this, false, gattCb, BluetoothDevice.TRANSPORT_LE);
    } catch (SecurityException e) { state("error", "Bluetooth permission was refused."); }
  }

  private void closeGatt() {
    try { if (gatt != null) { gatt.close(); } } catch (Exception ignored) {}
    gatt = null;
  }

  private final BluetoothGattCallback gattCb = new BluetoothGattCallback() {
    @Override public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        try { g.discoverServices(); } catch (SecurityException ignored) {}
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        main.post(() -> {
          if (!wantHr) { closeGatt(); return; }
          if (reconnects < MAX_RECONNECTS) {
            reconnects++;
            state("reconnecting", "");
            main.postDelayed(() -> { if (wantHr && device != null) openGatt(); }, 2000);
          } else {
            state("lost", "");
            wantHr = false;
            closeGatt();
          }
        });
      }
    }
    @Override public void onServicesDiscovered(BluetoothGatt g, int status) {
      try {
        if (g.getService(HR_SERVICE) == null) { main.post(() -> state("error", "That device has no heart-rate service.")); return; }
        BluetoothGattCharacteristic ch = g.getService(HR_SERVICE).getCharacteristic(HR_MEASUREMENT);
        if (ch == null) { main.post(() -> state("error", "No heart-rate measurement found.")); return; }
        g.setCharacteristicNotification(ch, true);
        BluetoothGattDescriptor cccd = ch.getDescriptor(CCCD);
        if (cccd != null) {
          cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
          g.writeDescriptor(cccd);
        } else {
          main.post(() -> { reconnects = 0; state("connected", ""); });
        }
      } catch (SecurityException ignored) {}
    }
    @Override public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
      main.post(() -> { reconnects = 0; state("connected", ""); });
    }
    @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch) {
      byte[] v = ch.getValue();
      if (v == null || v.length < 2) return;
      int flags = v[0] & 0xFF;
      int bpm = ((flags & 1) != 0 && v.length >= 3)
          ? ((v[2] & 0xFF) << 8) | (v[1] & 0xFF)
          : v[1] & 0xFF;
      if (bpm > 0) js("typeof conNativeSample==='function'&&conNativeSample(" + bpm + ")");
    }
  };

  /* ---------- activity results (file chooser, export, BT enable) ---------- */

  @Override protected void onActivityResult(int req, int res, Intent data) {
    super.onActivityResult(req, res, data);
    if (req == REQ_FILE) {
      if (fileCallback != null) {
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
        fileCallback = null;
      }
    } else if (req == REQ_EXPORT) {
      String content = pendingExport; pendingExport = null;
      if (res == RESULT_OK && data != null && data.getData() != null && content != null) {
        try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
          out.write(content.getBytes(StandardCharsets.UTF_8));
          toast("Backup saved.");
        } catch (Exception e) { toast("Could not save the backup."); }
      }
    } else if (req == REQ_OCR) {
      if (res == RESULT_OK && data != null && data.getData() != null) runOcr(data.getData());
    } else if (req == REQ_BT_ON) {
      if (res == RESULT_OK && pendingScan) { pendingScan = false; beginScanFlow(); }
      else if (pendingScan) { pendingScan = false; state("error", "Bluetooth stayed off."); }
    }
  }
}
