# Python starter diagnostic client

`echo_v3_ftms.py` contains an original parser and an optional Bleak live client.

## Parser-only test

```bash
python -m unittest test_echo_v3_ftms.py
```

## Live diagnostic

```bash
python -m pip install bleak
python echo_v3_ftms.py --name-prefix Echo
```

The diagnostic client is intentionally read-only. It subscribes to the FTMS Indoor Bike Data characteristic and prints raw/parsed notifications. It does not write to the Control Point or implement ANT+.

