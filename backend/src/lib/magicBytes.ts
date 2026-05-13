const MAGIC: Record<string, number[]> = {
    pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
    docx: [0x50, 0x4b, 0x03, 0x04], // PK ZIP/OOXML
    doc: [0xd0, 0xcf, 0x11, 0xe0], // OLE2 compound document
};

export function validateMagicBytes(buf: Buffer, ext: string): boolean {
    const magic = MAGIC[ext];
    if (!magic || buf.length < magic.length) return false;
    return magic.every((byte, i) => buf[i] === byte);
}
