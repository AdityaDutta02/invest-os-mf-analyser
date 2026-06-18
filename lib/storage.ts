// lib/storage.ts — Terminal AI Storage SDK (server-side only)
const GATEWAY_URL = process.env.TERMINAL_AI_GATEWAY_URL!

export async function storageUpload(key: string, buffer: Buffer, contentType: string, embedToken: string): Promise<{ key: string }> {
  const res = await fetch(`${GATEWAY_URL}/storage/${key}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${embedToken}`, 'Content-Type': contentType },
    body: buffer as unknown as BodyInit,
  })
  if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`)
  return res.json() as Promise<{ key: string }>
}

export async function storageGet(key: string, embedToken: string): Promise<Response> {
  const res = await fetch(`${GATEWAY_URL}/storage/${key}`, { headers: { Authorization: `Bearer ${embedToken}` } })
  if (!res.ok) throw new Error(`Storage get failed: ${res.status}`)
  return res
}

export async function storageList(embedToken: string): Promise<Array<{ key: string; size: number; lastModified: string }>> {
  const res = await fetch(`${GATEWAY_URL}/storage`, { headers: { Authorization: `Bearer ${embedToken}` } })
  if (!res.ok) throw new Error(`Storage list failed: ${res.status}`)
  return res.json() as Promise<Array<{ key: string; size: number; lastModified: string }>>
}

export async function storageDelete(key: string, embedToken: string): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/storage/${key}`, { method: 'DELETE', headers: { Authorization: `Bearer ${embedToken}` } })
  if (!res.ok) throw new Error(`Storage delete failed: ${res.status}`)
}
