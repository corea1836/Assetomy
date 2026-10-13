import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendUpload } from "./send-upload";

class FakeXhr extends EventTarget {
  static last: FakeXhr;
  upload = new EventTarget();
  status = 200;
  responseText = '{"result":{"kind":"duplicate","existingCardLabel":null}}';
  open = vi.fn();
  send = vi.fn();
  constructor() { super(); FakeXhr.last = this; }
}

beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXhr));
afterEach(() => vi.unstubAllGlobals());

describe("sendUpload", () => {
  it("posts FormData and reports analysis only after the upload load event", async () => {
    const onSent = vi.fn();
    const form = new FormData();
    form.set("cardId", "card-a");
    const pending = sendUpload(form, onSent);
    expect(FakeXhr.last.open).toHaveBeenCalledExactlyOnceWith("POST", "/api/uploads");
    expect(FakeXhr.last.send).toHaveBeenCalledExactlyOnceWith(form);
    expect(onSent).not.toHaveBeenCalled();
    FakeXhr.last.upload.dispatchEvent(new Event("load"));
    expect(onSent).toHaveBeenCalledOnce();
    FakeXhr.last.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toEqual({ status: 200, body: JSON.parse(FakeXhr.last.responseText) });
  });

  it("preserves API error status and body", async () => {
    const pending = sendUpload(new FormData(), vi.fn());
    FakeXhr.last.status = 422;
    FakeXhr.last.responseText = '{"error":{"code":"UNREADABLE","reason":"total_mismatch"}}';
    FakeXhr.last.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toEqual({ status: 422, body: { error: { code: "UNREADABLE", reason: "total_mismatch" } } });
  });

  it("tolerates a non-JSON response", async () => {
    const pending = sendUpload(new FormData(), vi.fn());
    FakeXhr.last.responseText = "<html>unavailable</html>";
    FakeXhr.last.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toEqual({ status: 200, body: null });
  });

  it.each(["error", "abort", "timeout"])("turns %s into status zero", async (event) => {
    const pending = sendUpload(new FormData(), vi.fn());
    FakeXhr.last.dispatchEvent(new Event(event));
    await expect(pending).resolves.toEqual({ status: 0, body: null });
  });
});
