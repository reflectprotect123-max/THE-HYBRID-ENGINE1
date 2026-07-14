import { connectLambda, getStore } from '@netlify/blobs';

// Netlify's Lambda-compatible function runtime passes the Blobs context on
// the event rather than exposing it as an environment variable. Initialize
// that context before any function reads or writes the shared store.
export function connectNetlifyBlobs(event) {
  if (typeof event?.blobs === 'string' && event.blobs) connectLambda(event);
}

const store = () => getStore({ name: 'hybrid-integrations', consistency: 'strong' });
export async function setJson(key, value) { await store().setJSON(key, value); }
export async function getJson(key) { return store().get(key, { type: 'json' }); }
export async function deleteKey(key) { await store().delete(key); }
