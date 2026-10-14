// 합성 PDF만 만든다. 원본 카드 이용내역은 테스트 파일에 저장하지 않는다.
export function makeTestPdf(
  streams: string[],
  encrypted = false,
  info?: { creationDate?: string },
): Uint8Array {
  const pages = streams.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages}] /Count ${streams.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, stream] of streams.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  let infoRef: number | undefined;
  if (info?.creationDate !== undefined) {
    infoRef = objects.length + 1;
    objects.push("<< /CreationDate (" + info.creationDate + ") >>");
  }

  let encryptionRef: number | undefined;
  if (encrypted) {
    encryptionRef = objects.length + 1;
    objects.push("<< /Filter /Standard /V 1 /R 2 /O <" + "00".repeat(32)
      + "> /U <" + "00".repeat(32) + "> /P -4 >>");
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  const encryption = encryptionRef
    ? " /Encrypt " + encryptionRef + " 0 R /ID [<" + "00".repeat(16) + "> <" + "00".repeat(16) + ">]"
    : "";
  const metadata = infoRef ? " /Info " + infoRef + " 0 R" : "";
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R" + encryption + metadata
    + " >>\nstartxref\n" + xref + "\n%%EOF\n";
  return new TextEncoder().encode(pdf);
}

export const TEST_TEXT_STREAM = "BT /F1 12 Tf 72 700 Td (HELLO) Tj 200 0 Td (1,000) Tj ET";
