/**
 * Shim for zlibjs/bin/gunzip.min.js
 * Replaces the old zlibjs library (which breaks in ES module scope because it uses `var aa = this`)
 * with a pako-based implementation of the Zlib.Gunzip API that kuromoji expects.
 */
import * as pako from 'pako';

class Gunzip {
  private _data: Uint8Array;

  constructor(data: Uint8Array) {
    this._data = data;
  }
  decompress() {
    return pako.inflate(this._data);
  }
}

export const Zlib = { Gunzip };
export default { Zlib };
