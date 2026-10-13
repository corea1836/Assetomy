export function sendUpload(
  form: FormData,
  onSent: () => void,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const failed = () => resolve({ status: 0, body: null });
    xhr.upload.addEventListener("load", onSent, { once: true });
    xhr.addEventListener("load", () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* Non-JSON failures use the temporary error message. */ }
      resolve({ status: xhr.status, body });
    }, { once: true });
    for (const event of ["error", "abort", "timeout"]) {
      xhr.addEventListener(event, failed, { once: true });
    }
    try {
      xhr.open("POST", "/api/uploads");
      xhr.send(form);
    } catch {
      failed();
    }
  });
}
