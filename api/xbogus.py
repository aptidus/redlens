"""
Douyin X-Bogus request signing — pure Python implementation.
Produces a 28-character token that Douyin appends to API query strings.

Algorithm: pack 21 bytes (version, timestamp, CRC32s, random) → encode with custom base-64 alphabet.
"""
import random
import struct
import time
import zlib

_ALPHABET = "Dkdpgh4ZKNfYB80/Mfvw36XI1R25-WUAlEi7NvjOoC3Tqnsm9b+VHL_FQq"


def _b64_encode(data: bytes) -> str:
    out = []
    for i in range(0, len(data) - 2, 3):
        v = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
        out.append(_ALPHABET[(v >> 18) & 0x3F])
        out.append(_ALPHABET[(v >> 12) & 0x3F])
        out.append(_ALPHABET[(v >> 6) & 0x3F])
        out.append(_ALPHABET[v & 0x3F])
    return "".join(out)


def compute_xbogus(query_str: str, ua: str) -> str:
    """
    Compute the X-Bogus query parameter for a Douyin API request.

    :param query_str: Full query string (all params, already URL-encoded, without X-Bogus itself).
    :param ua: User-Agent string used in the request.
    :returns: 28-character X-Bogus token.
    """
    crc_q = zlib.crc32(query_str.encode()) & 0xFFFFFFFF
    crc_ua = zlib.crc32(ua.encode()) & 0xFFFFFFFF
    ts = int(time.time())

    arr = bytearray(21)
    arr[0] = 0x02
    arr[1] = 0x14
    arr[2] = 0x10
    arr[3] = (crc_q ^ crc_ua ^ ts) & 0xFF
    struct.pack_into(">I", arr, 4, ts)
    arr[8] = random.randint(0, 255)
    arr[9] = random.randint(0, 255)
    arr[10] = random.randint(0, 255)
    struct.pack_into(">I", arr, 11, crc_q)
    struct.pack_into(">I", arr, 15, crc_ua)
    xor = 0
    for b in arr[:20]:
        xor ^= b
    arr[20] = xor

    return _b64_encode(bytes(arr))
