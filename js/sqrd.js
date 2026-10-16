/*************************************************************************
                                    
    QR Code Decoder (Alternative algorithm)

    Decoding QR Code forcely although it was badly damaged
    And extract valuable information on it

    Ported from Strong-QR-Decoder (sqrd.py) with some modifications
    (https://github.com/waidotto/strong-qr-decoder)	

************************************************************************/

var result = { message: "", error: [] };

EXT_ENCODING = [
    "Code page 437",
    "ISO/IEC 8859-1 (Latin-1)",
    "Code page 437",
    "ISO/IEC 8859-1 (Latin-1)",
    "ISO/IEC 8859-2 (Latin-2)",
    "ISO/IEC 8859-3 (Latin-3)",
    "ISO/IEC 8859-4 (Latin-4)",
    "ISO/IEC 8859-5 (Latin/Cyrillic)",
    "ISO/IEC 8859-6 (Latin/Arabic)",
    "ISO/IEC 8859-7 (Latin/Greek)",
    "ISO/IEC 8859-8 (Latin/Hebrew)",
    "ISO/IEC 8859-9 (Latin-5)",
    "ISO/IEC 8859-10 (Latin-6)",
    "ISO/IEC 8859-11 (Latin/Thai)",
    "Reversed",
    "ISO/IEC 8859-13 (Latin-7)",
    "ISO/IEC 8859-14 (Latin-8/Celtic)",
    "ISO/IEC 8859-15 (Latin-9)",
    "ISO/IEC 8859-16 (Latin-10)",
    "Reversed",
    "Shift JIS",
    "Windows-1250",
    "Windows-1251",
    "Windows-1252",
    "Windows-1256",
    "UTF-16BE",
    "UTF-8",
    "ISO/IEC 646:1991 IRV (US-ASCII)",
    "Big5",
    "GB/T 2312",
    "KS X 1001",
    "GBK",
    "GB 18030",
    "UTF-16LE",
    "UTF-32BE",
    "UTF-32LE"
]
EXT_ENCODING[170] = "ISO/IEC 646 INV";
EXT_ENCODING[899] = "8-bit binary data";

function getExtendedEncoding(code) {

    if (code > EXT_ENCODING.length) {
        return EXT_ENCODING[0];
    } else {
        return EXT_ENCODING[code];
    }
}

function hammingDistance(s1, s2) {
    if (s1.length != s1.length) {
        console.log("[ERROR]: inconsistent string lengths");
        result.error.push("Inconsistent string lengths");
    }
    var r = 0;
    for (var i = 0; i < s1.length; i++) {
        if (s1[i] != s2[i]) {
            r += 1;
        }
    }

    return r;
}

function mask(pat, i, j) {
    if (pat == 0b0)
        return (i + j) % 2 == 0;
    if (pat == 0b1)
        return i % 2 == 0;
    if (pat == 0b10)
        return j % 3 == 0;
    if (pat == 0b11)
        return (i + j) % 3 == 0;
    if (pat == 0b100)
        return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
    if (pat == 0b101)
        return (i * j) % 2 + (i * j) % 3 == 0;
    if (pat == 0b110)
        return ((i * j) % 3 + (i * j)) % 2 == 0;
    if (pat == 0b111)
        return ((i * j) % 3 + (i + j)) % 2 == 0;
    console.log("[ERROR]: Invalid mask pattern");
}

function index2Vector(index) {
    var index2vector_table = [
        null, 1, 2, 4, 8, 16, 32, 64, 128, 29, 58, 116, 232, 205, 135, 19,
        38, 76, 152, 45, 90, 180, 117, 234, 201, 143, 3, 6, 12, 24, 48, 96,
        192, 157, 39, 78, 156, 37, 74, 148, 53, 106, 212, 181, 119, 238, 193, 159,
        35, 70, 140, 5, 10, 20, 40, 80, 160, 93, 186, 105, 210, 185, 111, 222,
        161, 95, 190, 97, 194, 153, 47, 94, 188, 101, 202, 137, 15, 30, 60, 120,
        240, 253, 231, 211, 187, 107, 214, 177, 127, 254, 225, 223, 163, 91, 182, 113,
        226, 217, 175, 67, 134, 17, 34, 68, 136, 13, 26, 52, 104, 208, 189, 103,
        206, 129, 31, 62, 124, 248, 237, 199, 147, 59, 118, 236, 197, 151, 51, 102,
        204, 133, 23, 46, 92, 184, 109, 218, 169, 79, 158, 33, 66, 132, 21, 42,
        84, 168, 77, 154, 41, 82, 164, 85, 170, 73, 146, 57, 114, 228, 213, 183,
        115, 230, 209, 191, 99, 198, 145, 63, 126, 252, 229, 215, 179, 123, 246, 241,
        255, 227, 219, 171, 75, 150, 49, 98, 196, 149, 55, 110, 220, 165, 87, 174,
        65, 130, 25, 50, 100, 200, 141, 7, 14, 28, 56, 112, 224, 221, 167, 83,
        166, 81, 162, 89, 178, 121, 242, 249, 239, 195, 155, 43, 86, 172, 69, 138,
        9, 18, 36, 72, 144, 61, 122, 244, 245, 247, 243, 251, 235, 203, 139, 11,
        22, 44, 88, 176, 125, 250, 233, 207, 131, 27, 54, 108, 216, 173, 71, 142
    ]
    if (index == null)
        return 0b00000000;
    else
        return index2vector_table[(((index % 255) + 255) % 255) + 1];
}

function vector2Index(v) {
    var vector2index_table = [
        null, 255, 1, 25, 2, 50, 26, 198, 3, 223, 51, 238, 27, 104, 199, 75,
        4, 100, 224, 14, 52, 141, 239, 129, 28, 193, 105, 248, 200, 8, 76, 113,
        5, 138, 101, 47, 225, 36, 15, 33, 53, 147, 142, 218, 240, 18, 130, 69,
        29, 181, 194, 125, 106, 39, 249, 185, 201, 154, 9, 120, 77, 228, 114, 166,
        6, 191, 139, 98, 102, 221, 48, 253, 226, 152, 37, 179, 16, 145, 34, 136,
        54, 208, 148, 206, 143, 150, 219, 189, 241, 210, 19, 92, 131, 56, 70, 64,
        30, 66, 182, 163, 195, 72, 126, 110, 107, 58, 40, 84, 250, 133, 186, 61,
        202, 94, 155, 159, 10, 21, 121, 43, 78, 212, 229, 172, 115, 243, 167, 87,
        7, 112, 192, 247, 140, 128, 99, 13, 103, 74, 222, 237, 49, 197, 254, 24,
        227, 165, 153, 119, 38, 184, 180, 124, 17, 68, 146, 217, 35, 32, 137, 46,
        55, 63, 209, 91, 149, 188, 207, 205, 144, 135, 151, 178, 220, 252, 190, 97,
        242, 86, 211, 171, 20, 42, 93, 158, 132, 60, 57, 83, 71, 109, 65, 162,
        31, 45, 67, 216, 183, 123, 164, 118, 196, 23, 73, 236, 127, 12, 111, 246,
        108, 161, 59, 82, 41, 157, 85, 170, 251, 96, 134, 177, 187, 204, 62, 90,
        203, 89, 95, 176, 156, 169, 160, 81, 11, 245, 22, 235, 122, 117, 44, 215,
        79, 174, 213, 233, 230, 231, 173, 232, 116, 214, 244, 234, 168, 80, 88, 175
    ];

    return vector2index_table[v];
}

function mulGF256(v1, v2) {
    if (v1 == 0b00000000 || v2 == 0b00000000)
        return 0b00000000;
    else
        return index2Vector(vector2Index(v1) + vector2Index(v2));
}

function calcSyndrome(RS_block, index) {
    var s = 0b00000000;
    //console.log(JSON.stringify(RS_block[0]));
    for (var i = 0; i < RS_block.length; i++) {
        s ^= mulGF256(RS_block[i], index2Vector(index * i));
        //console.log(i, JSON.stringify(RS_block[i]))//, index2Vector(index * i), mulGF256(RS_block[i], index2Vector(index * i)));
    }
    return s
}

function detGF256(A) {
    if (A.length != A[0].length) {
        console.log("[ERROR]: Not square Matrix");
    }
    var size = A.length;
    if (size == 1)
        return A[0][0];

    for (var i = 0; i < size - 1; i++) {
        if (A[i][i] == 0b00000000)
            continue;

        for (var j = i + 1; j < size; j++) {
            if (A[j][i] == 0b00000000)
                continue;
            var v = index2Vector(vector2Index(A[j][i]) - vector2Index(A[i][i]));
            //if(v == undefined) console.log(A[j][i], A[i][i], vector2Index(A[j][i]) - vector2Index(A[i][i]));
            for (var k = 0; k < size; k++) {
                A[j][k] ^= mulGF256(A[i][k], v);
            }
        }
    }

    var s = 0b00000001;
    for (var i = 0; i < size; i++) {
        s = mulGF256(s, A[i][i]);
    }

    return s;
}

function solveSE(A) {
    var size = A.length;
    if (size == 0)
        return [];

    for (var i = 0; i < size - 1; i++) {
        if (A[i][i] == 0b00000000)
            continue;
        for (var j = i + 1; j < size; j++) {
            if (A[j][i] == 0b00000000)
                continue;

            var v = index2Vector(vector2Index(A[j][i]) - vector2Index(A[i][i]));
            for (var k = 0; k < size + 1; k++) {
                A[j][k] ^= mulGF256(A[i][k], v);
            }
        }
    }

    var xs = [];

    var size2 = A[0].length;
    for (var i = 0; i < size; i++) {
        var x = A[size - (i + 1)][size2 - 1];
        for (var j = 0; j < i; j++) {
            x ^= mulGF256(xs[j], A[size - (i + 1)][size2 - (2 + j)]);
        }
        if (A[size - (i + 1)][size2 - (2 - i)] == 0b00000000) {
            console.log("[ERROR]: Error correction failed");
            result.error.push("Error correction failed");
        }
        x = mulGF256(x, index2Vector(-vector2Index(A[size - (i + 1)][size2 - (2 + i)])));
        xs.push(x);
    }

    return xs //!IMPORTANT;
}

function calcSigma(sigmas, index) {
    var s = 0b00000000;
    var len = sigmas.length;
    for (var i = 0; i < sigmas.length; i++) {
        s ^= mulGF256(sigmas[len - (1 + i)], index2Vector(index * i));
    }
    s ^= index2Vector(index * sigmas.length);
    return s;
}


function getDataModule(data) {

    var width = data.length;
    var version = (width - 21) / 4 + 1;
    var alignment = alignment_pattern_array[version - 1];
    var is_data_module = [];

    for (var x = 0; x < width; x++) {
        var t = [];
        for (var y = 0; y < width; y++) {
            if ((x <= 8 && y <= 8) || (width - 8 <= x && y <= 8) || (x <= 8 && width - 8 <= y) || x == 6 || y == 6)
                t.push(false);
            else
                t.push(true);
        }
        is_data_module.push(t);
    }

    for (var x = 0; x < alignment.length; x++) {
        for (var y = 0; y < alignment.length; y++) {
            if (!((alignment[x] < 9 && alignment[y] < 9) || (width - 10 < alignment[x] && alignment[y] < 9) || (alignment[x] < 9 && width - 10 < alignment[y]))) {
                for (var i = -2; i < -2 + 5; i++) {
                    for (var j = -2; j < -2 + 5; j++) {
                        is_data_module[alignment[x] + i][alignment[y] + j] = false;
                    }
                }
            }
        }
    }

    if (version >= 7) {
        for (var i = 0; i < 6; i++) {
            for (var j = 0; j < 3; j++) {
                is_data_module[i][(width) - 11 + j] = false
            }
        }
        for (var j = 0; j < 6; j++) {
            for (var i = 0; i < 3; i++) {
                is_data_module[(width) - 11 + i][j] = false
            }
        }
    }

    return is_data_module;
}

function getFormatInfo(data) {

    var width = data.length;
    var format_mask = "101010000010010";
    var format_info = "";
    var format_info_unmask = "";

    for (var i = 0; i < 15; i++) {
        if (i <= 5) {
            if (data[i][8] == 1)
                format_info += "1";
            else if (data[i][8] == 0)
                format_info += "0";
            else if (data[i][8] == -1)
                format_info += "?";
        } else if (i == 6) {
            if (data[i + 1][8] == 1)
                format_info += "1";
            else if (data[i + 1][8] == 0)
                format_info += "0";
            else if (data[i + 1][8] == -1)
                format_info += "?";
        } else {
            if (data[width - 8 + i - 7][8] == 1)
                format_info += "1";
            else if (data[width - 8 + i - 7][8] == 0)
                format_info += "0";
            else if (data[width - 8 + i - 7][8] == -1)
                format_info += "?";
        }
    }
    format_info = format_info.split("").reverse();

    for (var i = 0; i < format_info.length; i++) {
        var xored = parseInt(format_info[i]) ^ parseInt(format_mask.charAt(i));
        format_info_unmask += xored;
    }

    var error_correction_level = parseInt(format_info_unmask.substring(0, 2), 2);
    var mask_pattern = parseInt(format_info_unmask.substring(2, 5), 2);

    // Unknown bits are XORed as 0 above, so check them before unmasking
    var known = format_info.slice(0, 5).indexOf("?") == -1;

    return { ecc: error_correction_level, mask: mask_pattern, known: known };
}

function maskData(data_array, mask_pattern) {

    var width = data_array.length;
    var data = JSON.parse(JSON.stringify(data_array));
    var is_data_module = getDataModule(data);

    for (var x = 0; x < width; x++) {
        for (var y = 0; y < width; y++) {
            if (is_data_module[x][y] && mask(mask_pattern, x, y)) {
                if (data[x][y] == 0)
                    data[x][y] = 1;
                else if (data[x][y] == 1)
                    data[x][y] = 0;
            }
        }
    }

    return data;
}

// Data modules in placement order (zigzag from the bottom-right corner), as [x, y] pairs
function getModuleOrder(width, is_data_module) {

    var order = [];
    var x = width - 1;
    var y = width - 1;
    var tx;
    while (x >= 0 && y >= 0) {
        if (is_data_module[x][y])
            order.push([x, y]);
        if (y < 7) tx = y; else tx = y - 1;
        if (tx % 2 == 1)
            y -= 1;
        else {
            if (Math.floor(tx / 2) % 2 == 1) {
                if (x == 0)
                    y -= 1;
                else {
                    x -= 1;
                    y += 1;
                }
            }
            else {
                if (x == width - 1) {
                    if (Math.floor(tx / 2) == 3) y -= 1;
                    y -= 1;
                } else {
                    x += 1;
                    y += 1;
                }
            }
        }
    }

    return order;
}

// Codeword count of every Reed-Solomon block (the longer blocks come last)
function getBlockLayout(version, ecc) {

    var block_num = RS_block_num_table[version - 1][ecc];
    var data_total = data_code_num_table[version - 1][ecc];
    var short_len = Math.floor(data_total / block_num);
    var long_num = data_total % block_num;
    var layout = [];

    for (var i = 0; i < block_num; i++) {
        layout.push({
            data: short_len + (i >= block_num - long_num ? 1 : 0),
            ec: error_correction_code_table[version - 1][ecc]
        });
    }

    return layout;
}

// Read the codewords of an unmasked array and deinterleave them by Reed-Solomon block.
// Every codeword is { bits: "01?...", modules: ["x-y", ...] }
function readRSBlocks(data, version, ecc) {

    var order = getModuleOrder(data.length, getDataModule(data));
    var layout = getBlockLayout(version, ecc);

    var codewords = [];
    for (var i = 0; i + 8 <= order.length; i += 8) {
        var codeword = { bits: "", modules: [] };
        for (var j = i; j < i + 8; j++) {
            var value = data[order[j][0]][order[j][1]];
            codeword.bits += (value == -1) ? "?" : value;
            codeword.modules.push(order[j][0] + "-" + order[j][1]);
        }
        codewords.push(codeword);
    }

    var rs_blocks = [];
    for (var i = 0; i < layout.length; i++)
        rs_blocks.push({ data: [], ec: [] });

    var k = 0;
    for (var j = 0; j < layout[layout.length - 1].data; j++) {
        for (var i = 0; i < layout.length; i++) {
            if (j < layout[i].data)
                rs_blocks[i].data.push(codewords[k++]);
        }
    }
    for (var j = 0; j < layout[0].ec; j++) {
        for (var i = 0; i < layout.length; i++)
            rs_blocks[i].ec.push(codewords[k++]);
    }

    return rs_blocks;
}

var char_count_bits_table = {
    "0001": [10, 12, 14],
    "0010": [9, 11, 13],
    "0100": [8, 16, 16],
    "1000": [8, 10, 12]
};

// Length of the character count indicator of a mode ("0001", "0010", "0100" or "1000")
function getCharCountBits(mode, version) {

    var range = version <= 9 ? 0 : (version <= 26 ? 1 : 2);

    return char_count_bits_table[mode][range];
}

// Length of the data bits of a segment holding `count` characters
function getSegmentDataBits(mode, count) {

    if (mode == "0001")
        return Math.floor(count / 3) * 10 + [0, 4, 7][count % 3];
    if (mode == "0010")
        return Math.floor(count / 2) * 11 + (count % 2) * 6;
    if (mode == "0100")
        return count * 8;
    return count * 13;
}

function recoverPaddingBits(data_array) {

    var width = data_array.length;
    var version = (width - 21) / 4 + 1;
    var format_info = getFormatInfo(data_array);
    var mask_pattern = format_info.mask;
    var data = maskData(data_array, mask_pattern);
    var rs_blocks = readRSBlocks(data, version, format_info.ecc);

    // Data sequence (data codewords of every block, in order) and the module behind each bit
    var data_bits = "";
    var modules = [];
    for (var i = 0; i < rs_blocks.length; i++) {
        for (var j = 0; j < rs_blocks[i].data.length; j++) {
            data_bits += rs_blocks[i].data[j].bits;
            modules.push.apply(modules, rs_blocks[i].data[j].modules);
        }
    }

    // Skip the encoded segments to find where the message ends
    var pos = 0;
    while (pos + 4 <= data_bits.length) {
        var encoding_mode = data_bits.substring(pos, pos + 4);

        if (encoding_mode == "0000")
            break;

        if (encoding_mode == "0111") {
            var assignment = data_bits.substring(pos + 4, pos + 7);
            if (assignment.charAt(0) == "0")
                pos += 12;
            else if (assignment.substring(0, 2) == "10")
                pos += 20;
            else if (assignment == "110")
                pos += 28;
            else
                return "ERROR: Invalid ECI Assignment Number";

        } else if (/^(0001|0010|0100|1000)$/.test(encoding_mode)) {
            var count_bits = getCharCountBits(encoding_mode, version);
            var count_indicator = data_bits.substring(pos + 4, pos + 4 + count_bits);
            if (count_indicator.search(/\?/g) != -1)
                return "ERROR: Unknown Character Count Indicator";

            var character_count = parseInt(count_indicator, 2);
            pos += 4 + count_bits + getSegmentDataBits(encoding_mode, character_count);

        } else {
            if (pos == 0)
                return "ERROR: Unknown Encoding Mode";
            break;
        }
    }

    if (pos > data_bits.length)
        return "ERROR: Character Count Indicator exceeds the data capacity";
    if (pos == data_bits.length)
        return "ERROR: Current QR code didn't use padding bits";

    // Terminator (up to 4 bits), zeros up to the byte boundary, then alternating pad bytes
    var pad_byte = ["11101100", "00010001"];
    var result = "";
    var zeros = Math.min(4, data_bits.length - pos);
    zeros += (8 - (pos + zeros) % 8) % 8;
    for (var i = 0; i < zeros; i++)
        result += "0";
    for (var alternate = 0; pos + result.length < data_bits.length; alternate ^= 1)
        result += pad_byte[alternate];

    var result_array = data;
    for (var i = 0; i < result.length; i++) {
        var cord = modules[pos + i].split("-");
        result_array[cord[0]][cord[1]] = parseInt(result.charAt(i));
    }

    result_array = maskData(result_array, mask_pattern);

    return { result_array: result_array, after: result, before: data_bits.substring(pos) };
}

function QRDecode(data) {

    result = { message: "", error: [], error_count: 0, ecc: 0, mask_pattern: 0, erasure_count: 0, data_module_count: 0, module_order: [] };

    var width = data.length;
    var version = (width - 21) / 4 + 1;

    var is_data_module = getDataModule(data);

    var format_info = getFormatInfo(data);

    var error_correction_level = format_info.ecc;
    var mask_pattern = format_info.mask;
    console.log("Error Correction Level : ", error_correction_level, "Mask Pattern : ", mask_pattern);

    if (error_correction_level == 0b0000)
        result.ecc = "M";
    else if (error_correction_level == 0b0001)
        result.ecc = "L";
    else if (error_correction_level == 0b0010)
        result.ecc = "H";
    else if (error_correction_level == 0b0011)
        result.ecc = "Q";
    result.mask_pattern = mask_pattern;

    data = maskData(data, mask_pattern);

    var blocks = [];
    var block = "";
    count = 0;
    var x = width - 1;
    var y = width - 1;
    while (true) {
        if (x < 0 || y < 0)
            break;
        if (is_data_module[x][y]) {
            if (data[x][y] == -1)
                block += '?';
            else
                block += data[x][y];
            count += 1;
            if (count == 8) {
                blocks.push(block);
                block = "";
                count = 0;
            }
            result.module_order.push(x + "-" + y);
        }
        if (y < 7) tx = y; else tx = y - 1;
        if (tx % 2 == 1)
            y -= 1;
        else {
            if (Math.floor(tx / 2) % 2 == 1) {
                if (x == 0)
                    y -= 1;
                else {
                    x -= 1;
                    y += 1;
                }
            }
            else {
                if (x == width - 1) {
                    if (Math.floor(tx / 2) == 3) y -= 1;
                    y -= 1;
                } else {
                    x += 1;
                    y += 1;
                }
            }
        }
    }

    for (var i = 0; i < blocks.length; i++) {
        for (var j = 0; j < blocks.length; j++) {
            if (blocks[i].charAt(j) == '?') {
                result.erasure_count += 1;
                break;
            }
        }
    }

    result.data_blocks = JSON.stringify(blocks);
    result.data_module_count = blocks.length;
    console.log(JSON.stringify(blocks));

    var RS_blocks = [];
    var block_num = RS_block_num_table[version - 1][error_correction_level];
    var offset = data_code_num_table[version - 1][error_correction_level];

    for (var i = 0; i < block_num; i++) {
        var t = [];
        for (var j = 0; j < Math.floor(offset / block_num); j++) {
            t.push(blocks[j * block_num + i]);
        }
        if (offset % block_num != 0) {
            var remain = offset % block_num;
            if ((block_num - remain) <= i)
                t.push(blocks[Math.floor(offset / block_num) * block_num + (i - (block_num - remain))])
        }
        for (var j = 0; j < Math.floor((blocks.length - offset) / block_num); j++) {
            t.push(blocks[offset + j * block_num + i]);
        }
        t = t.reverse();
        RS_blocks.push(t);
    }
    console.log("RS Blocks : ", JSON.stringify(RS_blocks));

    var unknown_code_nums = [];
    for (var i = 0; i < RS_blocks.length; i++) {
        var s = 0;
        for (var j = 0; j < RS_blocks[i].length; j++) {
            if (RS_blocks[i][j].search(/\?/g) > -1)
                s += 1;
        }
        unknown_code_nums.push(s);
    }

    // Unknown codewords are shown as "?" so the RS decoder can treat them as erasures
    var RS_blocks_display = [];
    for (var i = 0; i < block_num; i++) {
        var display = [];
        for (var j = 0; j < RS_blocks[i].length; j++) {
            if (RS_blocks[i][j].search(/\?/g) > -1) {
                RS_blocks[i][j] = 0;
                display.push("?");
            } else {
                RS_blocks[i][j] = parseInt(RS_blocks[i][j], 2)
                display.push(RS_blocks[i][j]);
            }
        }
        RS_blocks_display.push(display);
    }
    console.log("RS Blocks : ", JSON.stringify(RS_blocks));

    var limit_error_correction_num;

    if (version == 1) {
        if (error_correction_level == 0b01)
            limit_error_correction_num = 2;
        else if (error_correction_level == 0b00)
            limit_error_correction_num = 4;
        else if (error_correction_level == 0b11)
            limit_error_correction_num = 6;
        else if (error_correction_level == 0b10)
            limit_error_correction_num = 8;
    } else if (version == 2 && error_correction_level == 0b01) {
        limit_error_correction_num = 4;
    } else if (version == 3 && error_correction_level == 0b01) {
        limit_error_correction_num = 7;
    } else {
        limit_error_correction_num = Math.floor((blocks.length - offset) / block_num) / 2;
    }
    //console.log(limit_error_correction_num);

    result.rs_block = [];
    result.syndrome = [];
    result.error_count = [];
    result.coeff_error = [];
    result.error_position = [];
    result.error_magnitude = [];
    much_missing_bits = false;
    //Error correction here!!!!!!!!!!!
    for (var i = 0; i < block_num; i++) {
        result.rs_block.push("[" + Array.prototype.slice.call(RS_blocks_display[i]).reverse().join(",") + "]");
        if (limit_error_correction_num < unknown_code_nums[i]) {
            much_missing_bits = true;
            continue;
        }
        var syndrome_length = Math.floor((blocks.length - offset) / block_num);

        var syndromes = [];
        for (var j = 0; j < syndrome_length; j++) {
            syndromes.push(calcSyndrome(RS_blocks[i], j))
        }
        result.syndrome.push(JSON.stringify(syndromes));

        var no_error = true;
        for (var j = 0; j < syndrome_length; j++) {
            if (syndromes[j] != 0b00000000)
                no_error = false;
        }
        console.log("Syndromes : ", JSON.stringify(syndromes));
        if (no_error)
            continue;

        var A;
        for (var size = Math.floor(syndrome_length / 2) - 1; size > 0; size--) {
            A = [];
            for (var j = 0; j < size; j++) {
                var row = [];
                for (var k = 0; k < size; k++) {
                    row.push(syndromes[j + k]);
                }
                A.push(row);
            }
            var det = detGF256(A);
            if (det != 0b00000000) {
                break;
            }
        }
        //console.log(JSON.stringify(A));

        var num_error = A.length; console.log("Number of Errors : ", num_error);
        result.error_count.push(num_error);
        A = [];
        for (var j = 0; j < num_error; j++) {
            var row = [];
            for (var k = 0; k < num_error + 1; k++) {
                row.push(syndromes[j + k]);
            }
            A.push(row);
        }
        var sigmas = solveSE(Array.prototype.slice.call(A));
        result.coeff_error.push(JSON.stringify(sigmas));

        var indexes = [];
        for (var j = 0; j < RS_blocks[i].length; j++) {
            var s = calcSigma(sigmas, j);
            if (s == 0b00000000)
                indexes.push(j);
        }
        console.log("Error positions : ", indexes);
        result.error_position.push(JSON.stringify(indexes));

        A = [];
        for (var j = 0; j < indexes.length; j++) {
            var row = [];
            for (var k = 0; k < indexes.length; k++) {
                row.push(index2Vector(j * indexes[k]));
            }
            row.push(syndromes[j]);
            A.push(row);
        }

        var errors = solveSE(Array.prototype.slice.call(A)).reverse();
        var errors_str = "";
        for (var j = 0; j < errors.length; j++) {
            errors_str += errors[j].toString(2) + " ";
        }
        result.error_magnitude.push(errors_str);

        for (var j = 0; j < indexes.length; j++) {
            RS_blocks[i][indexes[j]] ^= errors[j];
        }
        console.log("RS Blocks after error correction : ", JSON.stringify(RS_blocks));
    }

    if (much_missing_bits) result.error.push("Too much missing bits");

    for (var i = 0; i < RS_blocks.length; i++) {
        RS_blocks[i] = RS_blocks[i].reverse();
    }

    var data_bytes = [];
    for (var i = 0; i < RS_blocks.length; i++) {
        if ((block_num - (offset % block_num)) <= i)
            var val = 1;
        else
            var val = 0;
        var limit = Math.floor(offset / block_num) + val;
        for (var j = 0; j < limit; j++) {
            data_bytes.push(RS_blocks[i][j]);
        }
    }
    console.log("Data bytes : ", JSON.stringify(data_bytes));

    var data_bits = "";
    for (var i = 0; i < data_bytes.length; i++) {
        var pad = "00000000";
        var text = data_bytes[i].toString(2);
        var remain = (pad + text).length - 8;
        text = (pad + text).slice(remain);
        data_bits += text;
    }
    console.log("Data bits :", data_bits);
    result.data_bits = data_bits;

    var data = [];
    result.data_bits_count = 0;
    result.data_bits_block = [];
    result.mode = [];
    result.count = [];
    result.decoded = [];
    while (data_bits.length != 0) {
        mode = parseInt(data_bits.substring(0, 4), 2);
        var temp_data = "[" + data_bits.substring(0, 4) + "] ";
        data_bits = data_bits.substring(4);

        if (mode == 0b0001) {
            var length_indicator = 10;
            if (version > 9 && version <= 26) {
                length_indicator = 12;
            } else if (version > 26) {
                length_indicator = 14;
            }

            var num = "";
            length = parseInt(data_bits.substring(0, length_indicator), 2);
            temp_data += "[" + data_bits.substring(0, length_indicator) + "] [";
            data_bits = data_bits.substring(length_indicator);
            console.log("Data length : ", length);
            console.log("Data sequence : ", data_bits);

            result.mode.push("Numeric Mode (0001)");
            result.count.push(length);

            for (var i = 0; i < Math.floor((length + 2) / 3); i++) {
                if (i == Math.floor((length + 2) / 3) - 1) {
                    if (length % 3 == 0) {
                        num += parseInt(data_bits.substring(0, 10), 2).toString().padStart(3, "0");
                        temp_data += data_bits.substring(0, 10);
                        data_bits = data_bits.substring(10);
                    } else if (length % 3 == 1) {
                        num += parseInt(data_bits.substring(0, 4), 2).toString();
                        temp_data += data_bits.substring(0, 4);
                        data_bits = data_bits.substring(4);
                    } else {
                        num += parseInt(data_bits.substring(0, 7), 2).toString().padStart(2, "0");
                        temp_data += data_bits.substring(0, 7);
                        data_bits = data_bits.substring(7);
                    }
                } else {
                    num += parseInt(data_bits.substring(0, 10), 2).toString().padStart(3, "0");
                    temp_data += data_bits.substring(0, 10);
                    data_bits = data_bits.substring(10);
                }
            }
            temp_data += "]";
            result.decoded.push(num);

            data.push.apply(data, num.split(""));

        } else if (mode == 0b0010) {
            var length_indicator = 9;
            if (version > 9 && version <= 26) {
                length_indicator = 11;
            } else if (version > 26) {
                length_indicator = 13;
            }

            var current_data = "";
            length = parseInt(data_bits.substring(0, length_indicator), 2);
            temp_data += "[" + data_bits.substring(0, length_indicator) + "] [";
            data_bits = data_bits.substring(length_indicator);
            console.log("Data length : ", length);
            console.log("Data sequence : ", data_bits);

            result.mode.push("Alphanumeric Mode (0010)");
            result.count.push(length);

            for (var i = 0; i < Math.floor((length + 1) / 2); i++) {
                if (i == Math.floor((length + 1) / 2) - 1) {
                    if (length % 2 == 0) {
                        num = (parseInt(data_bits.substring(0, 11), 2));
                        temp_data += data_bits.substring(0, 11);
                        data_bits = data_bits.substring(11);
                        data.push(alphanumeric_table[Math.floor(num / 45)]);
                        data.push(alphanumeric_table[num % 45]);
                        current_data += alphanumeric_table[Math.floor(num / 45)];
                        current_data += alphanumeric_table[Math.floor(num % 45)];
                    } else {
                        num = (parseInt(data_bits.substring(0, 6), 2));
                        temp_data += data_bits.substring(0, 6);
                        data_bits = data_bits.substring(6);
                        data.push(alphanumeric_table[num]);
                        current_data += alphanumeric_table[num];
                    }
                } else {
                    num = (parseInt(data_bits.substring(0, 11), 2));
                    temp_data += data_bits.substring(0, 11);
                    data_bits = data_bits.substring(11);
                    data.push(alphanumeric_table[Math.floor(num / 45)]);
                    data.push(alphanumeric_table[num % 45]);
                    current_data += alphanumeric_table[Math.floor(num / 45)];
                    current_data += alphanumeric_table[Math.floor(num % 45)];
                }
            }
            temp_data += "]";
            result.decoded.push(current_data);

        } else if (mode == 0b0100) {
            var length_indicator = 8;
            if (version > 9) {
                length_indicator = 16;
            }

            var current_data = "";
            length = parseInt(data_bits.substring(0, length_indicator), 2);
            temp_data += "[" + data_bits.substring(0, length_indicator) + "] [";
            data_bits = data_bits.substring(length_indicator);
            console.log("Data length : ", length);
            console.log("Data sequence : ", data_bits);

            result.mode.push("8-bit Mode (0100)");
            result.count.push(length);

            for (var i = 0; i < length; i++) {
                data.push(String.fromCharCode(parseInt(data_bits.substring(0, 8), 2)));
                temp_data += data_bits.substring(0, 8);
                current_data += String.fromCharCode(parseInt(data_bits.substring(0, 8), 2));
                data_bits = data_bits.substring(8);
            }
            temp_data += "]";
            result.decoded.push(current_data);
        } else if (mode == 0b0000) {
            break;
        } else if (mode == 0b1000) {
            //TODO: Kanji mode
            break;
        } else if (mode == 0b0111) {
            // ECI Mode
            result.mode.push("ECI Mode (0111)");

            if (data_bits.substring(0, 1) == "0") {

                temp_data += "[" + data_bits.substring(0, 8) + "]";
                special_encoding = parseInt(data_bits.substring(0, 8), 2);
                data_bits = data_bits.substring(8);

                result.count.push(special_encoding);
                result.decoded.push(getExtendedEncoding(special_encoding));

            } else if (data_bits.substring(0, 2) == "10") {

                temp_data += "[" + data_bits.substring(0, 16) + "]";
                special_encoding = parseInt(data_bits.substring(0, 16), 2);
                data_bits = data_bits.substring(16);

                result.count.push(special_encoding);
                result.decoded.push(getExtendedEncoding(special_encoding));
            } else if (data_bits.substring(0, 3) == "110") {

                temp_data += "[" + data_bits.substring(0, 24) + "]";
                special_encoding = parseInt(data_bits.substring(0, 24), 2);
                data_bits = data_bits.substring(24);

                result.count.push(special_encoding);
                result.decoded.push(getExtendedEncoding(special_encoding));
            } else {
                console.log("[ERROR]: Invalid ECI Assignment Number");
                result.error.push("[ERROR]: Invalid ECI Assignment Number");
                break;
            }
        } else {
            console.log("[ERROR]: Invalid Encoding mode", mode);
            result.error.push("Invalid Encoding mode");
            break;
        }
        result.data_bits_block.push(temp_data);
        result.data_bits_count += 1;
    }
    console.log(data.join(""));

    result.message = data.join("");

    return result;
}

// Data codewords of every block in sequence, followed by the error correction codewords of every block
function readDataBlock(data) {

    var width = data.length;
    var version = (width - 21) / 4 + 1;
    var format_info = getFormatInfo(data);
    var rs_blocks = readRSBlocks(maskData(data, format_info.mask), version, format_info.ecc);

    var bits = "";
    var module_order = [];
    var parts = ["data", "ec"];
    for (var p = 0; p < parts.length; p++) {
        for (var i = 0; i < rs_blocks.length; i++) {
            var codewords = rs_blocks[i][parts[p]];
            for (var j = 0; j < codewords.length; j++) {
                bits += codewords[j].bits;
                module_order.push.apply(module_order, codewords[j].modules);
            }
        }
    }

    return { blocks: bits, module_order: module_order, rs_blocks: rs_blocks };
}

function readDataBits(data_bits) {

    var data = [];
    while (data_bits.length != 0) {
        mode = parseInt(data_bits.substring(0, 4), 2);
        var temp_data = "[" + data_bits.substring(0, 4) + "] ";
        data_bits = data_bits.substring(4);

        if (mode == 0b0001) {
            var length_indicator = 10;
            if (qr_version > 9 && qr_version <= 26) {
                length_indicator = 12;
            } else if (qr_version > 26) {
                length_indicator = 14;
            }

            var num = "";
            length = parseInt(data_bits.substring(0, length_indicator), 2);
            temp_data += "[" + data_bits.substring(0, length_indicator) + "] [";
            data_bits = data_bits.substring(length_indicator);
            console.log("Data length : ", length);
            console.log("Data sequence : ", data_bits);

            for (var i = 0; i < Math.floor((length + 2) / 3); i++) {
                if (i == Math.floor((length + 2) / 3) - 1) {
                    if (length % 3 == 0) {
                        num += parseInt(data_bits.substring(0, 10), 2).toString().padStart(3, "0");
                        temp_data += data_bits.substring(0, 10);
                        data_bits = data_bits.substring(10);
                    } else if (length % 3 == 1) {
                        num += parseInt(data_bits.substring(0, 4), 2).toString();
                        temp_data += data_bits.substring(0, 4);
                        data_bits = data_bits.substring(4);
                    } else {
                        num += parseInt(data_bits.substring(0, 7), 2).toString().padStart(2, "0");
                        temp_data += data_bits.substring(0, 7);
                        data_bits = data_bits.substring(7);
                    }
                } else {
                    num += parseInt(data_bits.substring(0, 10), 2).toString().padStart(3, "0");
                    temp_data += data_bits.substring(0, 10);
                    data_bits = data_bits.substring(10);
                }
            }
            temp_data += "]";
            result.decoded.push(num);

            data.push.apply(data, num.split(""));

        } else if (mode == 0b0010) {
            var length_indicator = 9;
            if (qr_version > 9 && qr_version <= 26) {
                length_indicator = 11;
            } else if (qr_version > 26) {
                length_indicator = 13;
            }

            var current_data = "";
            length = parseInt(data_bits.substring(0, length_indicator), 2);
            temp_data += "[" + data_bits.substring(0, length_indicator) + "] [";
            data_bits = data_bits.substring(length_indicator);
            console.log("Data length : ", length);
            console.log("Data sequence : ", data_bits);

            for (var i = 0; i < Math.floor((length + 1) / 2); i++) {
                if (i == Math.floor((length + 1) / 2) - 1) {
                    if (length % 2 == 0) {
                        num = (parseInt(data_bits.substring(0, 11), 2));
                        temp_data += data_bits.substring(0, 11);
                        data_bits = data_bits.substring(11);
                        data.push(alphanumeric_table[Math.floor(num / 45)]);
                        data.push(alphanumeric_table[num % 45]);
                        current_data += alphanumeric_table[Math.floor(num / 45)];
                        current_data += alphanumeric_table[Math.floor(num % 45)];
                    } else {
                        num = (parseInt(data_bits.substring(0, 6), 2));
                        temp_data += data_bits.substring(0, 6);
                        data_bits = data_bits.substring(6);
                        data.push(alphanumeric_table[num]);
                        current_data += alphanumeric_table[num];
                    }
                } else {
                    num = (parseInt(data_bits.substring(0, 11), 2));
                    temp_data += data_bits.substring(0, 11);
                    data_bits = data_bits.substring(11);
                    data.push(alphanumeric_table[Math.floor(num / 45)]);
                    data.push(alphanumeric_table[num % 45]);
                    current_data += alphanumeric_table[Math.floor(num / 45)];
                    current_data += alphanumeric_table[Math.floor(num % 45)];
                }
            }
            temp_data += "]";

        } else if (mode == 0b0100) {
            var length_indicator = 8;
            if (qr_version > 9) {
                length_indicator = 16;
            }

            var current_data = "";
            length = parseInt(data_bits.substring(0, length_indicator), 2);
            temp_data += "[" + data_bits.substring(0, length_indicator) + "] [";
            data_bits = data_bits.substring(length_indicator);
            console.log("Data length : ", length);
            console.log("Data sequence : ", data_bits);

            for (var i = 0; i < length; i++) {
                data.push(String.fromCharCode(parseInt(data_bits.substring(0, 8), 2)));
                temp_data += data_bits.substring(0, 11);
                current_data += String.fromCharCode(parseInt(data_bits.substring(0, 8), 2));
                data_bits = data_bits.substring(8);
            }
            temp_data += "]";
        } else if (mode == 0b0000) {
            break;
        } else if (mode == 0b1000) {
            //TODO: Kanji mode
            console.log("Unsupported encoding: Kanji Mode");
            break;
        } else if (mode == 0b0111) {
            // ECI Mode
            if (data_bits.substring(0, 1) == "0") {
                special_encoding = data_bits.substring(0, 8);
                data_bits = data_bits.substring(8);
            } else if (data_bits.substring(0, 2) == "10") {
                special_encoding = data_bits.substring(0, 16);
                data_bits = data_bits.substring(16);
            } else if (data_bits.substring(0, 3) == "110") {
                special_encoding = data_bits.substring(0, 24);
                data_bits = data_bits.substring(24);
            } else {
                console.log("[ERROR]: Invalid ECI Assignment Number");
                break;
            }
        } else {
            console.log("[ERROR]: Invalid Encoding mode");
            break;
        }
    }

    return data.join("");
}
