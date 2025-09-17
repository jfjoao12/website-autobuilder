// /app/lib/zip.ts
import { Buffer } from "buffer";

export type ZipInput = {
    filename: string;
    data: Uint8Array;
};

const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

const crc32 = (data: Uint8Array) => {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
};

const getDosTime = (date: Date) => {
    const seconds = Math.floor(date.getSeconds() / 2);
    return (date.getHours() << 11) | (date.getMinutes() << 5) | seconds;
};

const getDosDate = (date: Date) => {
    const year = Math.max(1980, date.getFullYear()) - 1980;
    return (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
};

export const createZip = (entries: ZipInput[]): Buffer => {
    const encoder = new TextEncoder();
    const now = new Date();
    const modTime = getDosTime(now);
    const modDate = getDosDate(now);

    const localChunks: Uint8Array[] = [];
    const centralChunks: Uint8Array[] = [];
    const records: {
        fileNameBytes: Uint8Array;
        crc32: number;
        compressedSize: number;
        uncompressedSize: number;
        headerOffset: number;
    }[] = [];

    let offset = 0;

    entries.forEach((entry) => {
        const normalizedName = entry.filename.replace(/\\+/g, "/");
        const fileNameBytes = encoder.encode(normalizedName);
        const data = entry.data;
        const crc = crc32(data);

        const localHeaderBuffer = new ArrayBuffer(30);
        const localView = new DataView(localHeaderBuffer);
        localView.setUint32(0, 0x04034b50, true); // Local file header signature
        localView.setUint16(4, 20, true); // Version needed to extract
        localView.setUint16(6, 0, true); // General purpose bit flag
        localView.setUint16(8, 0, true); // Compression method (0 = store)
        localView.setUint16(10, modTime, true);
        localView.setUint16(12, modDate, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, data.length, true);
        localView.setUint32(22, data.length, true);
        localView.setUint16(26, fileNameBytes.length, true);
        localView.setUint16(28, 0, true); // extra field length
        const localHeader = new Uint8Array(localHeaderBuffer);

        localChunks.push(localHeader, fileNameBytes, data);

        records.push({
            fileNameBytes,
            crc32: crc,
            compressedSize: data.length,
            uncompressedSize: data.length,
            headerOffset: offset,
        });

        offset += localHeader.length + fileNameBytes.length + data.length;
    });

    const centralOffset = offset;
    let centralSize = 0;

    records.forEach((record) => {
        const centralBuffer = new ArrayBuffer(46);
        const centralView = new DataView(centralBuffer);
        centralView.setUint32(0, 0x02014b50, true); // Central file header signature
        centralView.setUint16(4, 20, true); // Version made by
        centralView.setUint16(6, 20, true); // Version needed to extract
        centralView.setUint16(8, 0, true); // General purpose bit flag
        centralView.setUint16(10, 0, true); // Compression method
        centralView.setUint16(12, modTime, true);
        centralView.setUint16(14, modDate, true);
        centralView.setUint32(16, record.crc32, true);
        centralView.setUint32(20, record.compressedSize, true);
        centralView.setUint32(24, record.uncompressedSize, true);
        centralView.setUint16(28, record.fileNameBytes.length, true);
        centralView.setUint16(30, 0, true); // extra field length
        centralView.setUint16(32, 0, true); // file comment length
        centralView.setUint16(34, 0, true); // disk number start
        centralView.setUint16(36, 0, true); // internal file attributes
        centralView.setUint32(38, 0, true); // external file attributes
        centralView.setUint32(42, record.headerOffset, true);
        const centralHeader = new Uint8Array(centralBuffer);

        centralChunks.push(centralHeader, record.fileNameBytes);
        centralSize += centralHeader.length + record.fileNameBytes.length;
    });

    const endBuffer = new ArrayBuffer(22);
    const endView = new DataView(endBuffer);
    endView.setUint32(0, 0x06054b50, true); // End of central dir signature
    endView.setUint16(4, 0, true); // Number of this disk
    endView.setUint16(6, 0, true); // Disk where central directory starts
    endView.setUint16(8, records.length, true); // Number of central dir records on this disk
    endView.setUint16(10, records.length, true); // Total number of central dir records
    endView.setUint32(12, centralSize, true); // Size of central directory
    endView.setUint32(16, centralOffset, true); // Offset of central directory
    endView.setUint16(20, 0, true); // Comment length
    const endRecord = new Uint8Array(endBuffer);

    const totalSize = [...localChunks, ...centralChunks, endRecord].reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(totalSize);
    let pointer = 0;

    for (const chunk of localChunks) {
        output.set(chunk, pointer);
        pointer += chunk.length;
    }
    for (const chunk of centralChunks) {
        output.set(chunk, pointer);
        pointer += chunk.length;
    }
    output.set(endRecord, pointer);

    return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
};
