/** Thin fetch wrapper for client components: JSON in, JSON out, throws with the
 * server's error message so callers can show it directly in a toast. */
export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  const isFormData = options.body instanceof FormData;
  if (!isFormData && options.body) headers["Content-Type"] = "application/json";

  const res = await fetch(url, { ...options, headers, credentials: "same-origin" });

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `เกิดข้อผิดพลาด (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  get: <T = unknown>(url: string) => apiFetch<T>(url),
  post: <T = unknown>(url: string, body?: unknown) =>
    apiFetch<T>(url, {
      method: "POST",
      // Multipart FormData must be sent unchanged so the browser supplies its
      // boundary; serializing it to JSON drops the selected file.
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),
  put: <T = unknown>(url: string, body?: unknown) =>
    apiFetch<T>(url, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T = unknown>(url: string, body?: unknown) =>
    apiFetch<T>(url, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T = unknown>(url: string) => apiFetch<T>(url, { method: "DELETE" }),
};
