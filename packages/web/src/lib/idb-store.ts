// Minimal promise-wrapped IndexedDB key/value store (§4.1).
//
// Used to persist the browser device key (device-key.ts). IndexedDB — not
// localStorage — because a non-extractable Ed25519 `CryptoKey` is a structured-
// cloneable object that IndexedDB stores by reference WITHOUT exposing its key
// material: the private key can be retrieved and used to sign, but never read
// out as bytes (invariant #8). localStorage cannot hold a CryptoKey at all (it
// only stores strings, which would force an extractable JWK — exactly what this
// design eliminates vs the bridge in browser-author-key.ts).
//
// Deliberately tiny: one object store, get/put/delete. No schema migrations
// beyond first-create; the device key is the only resident.

const DB_NAME = 'skillet-device-keys'
const STORE = 'keys'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'))
  })
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let settled = false
        const finish = (next: () => void) => {
          if (settled) return
          settled = true
          db.close()
          next()
        }

        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))

        request.onsuccess = () => {
          // We resolve on transaction.oncomplete so the write is durable.
        }
        request.onerror = () => {
          finish(() => reject(request.error ?? new Error('IndexedDB request failed')))
        }
        transaction.oncomplete = () => {
          finish(() => resolve(request.result))
        }
        transaction.onerror = () => {
          finish(() => reject(transaction.error ?? new Error('IndexedDB transaction failed')))
        }
        transaction.onabort = () => {
          finish(() => reject(transaction.error ?? new Error('IndexedDB transaction aborted')))
        }
      }),
  )
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return tx<T | undefined>('readonly', (store) => store.get(key) as IDBRequest<T | undefined>)
}

export function idbPut(key: string, value: unknown): Promise<void> {
  return tx<IDBValidKey>('readwrite', (store) => store.put(value as never, key)).then(
    () => undefined,
  )
}

export function idbDelete(key: string): Promise<void> {
  return tx<undefined>('readwrite', (store) => store.delete(key) as IDBRequest<undefined>).then(
    () => undefined,
  )
}
