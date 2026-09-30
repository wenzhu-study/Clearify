import type { SavedImage } from './types'

const STORE = 'images'
let database: Promise<IDBDatabase> | undefined

function openDatabase() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('clearify-local', 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('本地存储被占用，请关闭其他 Clearify 标签页。'))
    }).catch((error) => {
      database = undefined
      throw error
    })
  }
  return database
}

export async function getHistory(): Promise<SavedImage[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    request.onsuccess = () =>
      resolve((request.result as SavedImage[]).sort((a, b) => b.createdAt - a.createdAt))
    request.onerror = () => reject(request.error)
  })
}

export async function saveImage(image: SavedImage) {
  const history = await getHistory()
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    let totalBytes = image.blob.size + image.original.size
    let count = 1
    store.put(image)
    for (const item of history) {
      totalBytes += item.blob.size + item.original.size
      if (count >= 12 || totalBytes > 120 * 1024 * 1024) store.delete(item.id)
      else count++
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function deleteImage(id: string) {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}
