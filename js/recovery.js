/*************************************************************************

    Smart Recovery

    Fills unknown codewords using everything that is known about them:
      - known modules (a partially known codeword has fewer candidates)
      - the data sequence grammar: mode indicators, character counts,
        character sets, terminator and padding
      - the Reed-Solomon parity equations, solved as a linear system over
        GF(256), with a search over the candidates when there are more
        unknown codewords than error correction codewords

    Known modules are assumed to be right (erasures only). When that leads
    nowhere, the errors and erasures decoder is tried as a fallback.

************************************************************************/

var SR_LIMITS = {
    visits: 200000,     // grammar parser steps before the grammar is ignored
    search: 4000000,    // candidate combinations tried per block
    solutions: 1024     // solutions kept per block, to rank by readability
};

var SR_PAD_BYTES = [0xEC, 0x11];

// Known bits of bits[start, start + len) as { mask, value } (len <= 16)
function srKnown(bits, start, len) {

    var mask = 0;
    var value = 0;
    for (var i = 0; i < len; i++) {
        var c = bits.charAt(start + i);
        mask <<= 1;
        value <<= 1;
        if (c == "0" || c == "1") {
            mask |= 1;
            if (c == "1")
                value |= 1;
        }
    }

    return { mask: mask, value: value };
}

// Values of a len-bit field that agree with the known bits and lie in [lo, hi], in ascending order
function srMatchingValues(known, len, lo, hi) {

    var free = ((1 << len) - 1) & ~known.mask;
    var values = [];
    var sub = 0;
    do {
        var value = known.value | sub;
        if (value >= lo && value <= hi)
            values.push(value);
        sub = (sub - free) & free;
    } while (sub != 0);

    return values;
}

/*
    Grammar of a data sequence: segments (mode indicator, character count, data), then the
    terminator and the alternating pad bytes. A field { start, len, lo, hi } constrains
    bits[start, start + len) to a value in [lo, hi]. Byte and kanji data have no field,
    since any value is valid there.

    Whether a valid parse exists from a position on doesn't depend on how that position was
    reached, so it is memoized (valid). Work is bounded by limits.visits: past it, the
    functions throw grammar.truncated.
*/
function srGrammar(bits, version, limits) {

    var capacity = bits.length;
    var grammar = { capacity: capacity, truncated: {}, visits: 0 };

    function tick() {
        if (++grammar.visits > limits.visits)
            throw grammar.truncated;
    }

    var field_memo = new Map();
    function consistent(start, len, lo, hi) {
        var key = ((start * 32 + len) * 65536 + lo) * 65536 + hi;
        var ok = field_memo.get(key);
        if (ok === undefined) {
            var known = srKnown(bits, start, len);
            if (lo == hi)
                ok = (lo & known.mask) == known.value;
            else
                ok = srMatchingValues(known, len, lo, hi).length > 0;
            field_memo.set(key, ok);
        }
        return ok;
    }

    // pad_ok[p][i]: bytes i.. hold the alternating pad bytes, starting with SR_PAD_BYTES[p]
    var bytes = capacity / 8;
    var pad_ok = [new Uint8Array(bytes + 1), new Uint8Array(bytes + 1)];
    pad_ok[0][bytes] = pad_ok[1][bytes] = 1;
    for (var i = bytes - 1; i >= 0; i--) {
        for (var p = 0; p < 2; p++)
            pad_ok[p][i] = consistent(8 * i, 8, SR_PAD_BYTES[p], SR_PAD_BYTES[p]) && pad_ok[p ^ 1][i + 1] ? 1 : 0;
    }

    // Terminator: zeros up to the byte boundary (fewer when there's no room), then padding
    grammar.terminatorZeros = function (pos) {
        var remaining = capacity - pos;
        return remaining < 4 ? remaining : 4 + (8 - (pos + 4) % 8) % 8;
    };

    grammar.terminatorOk = function (pos) {
        var zeros = grammar.terminatorZeros(pos);
        return (zeros == 0 || consistent(pos, zeros, 0, 0)) && pad_ok[0][(pos + zeros) / 8] == 1;
    };

    // Character set limits of numeric (10-bit groups < 1000) and alphanumeric (11-bit groups < 2025)
    var GROUPS = {
        "0001": { len: 10, max: 999, chars: 3, rest: [null, [4, 9], [7, 99]] },
        "0010": { len: 11, max: 45 * 45 - 1, chars: 2, rest: [null, [6, 44]] }
    };

    // Number of consecutive valid full groups starting at a position
    var full_groups = { "0001": new Map(), "0010": new Map() };
    function fullGroups(mode, start) {
        var memo = full_groups[mode];
        var g = GROUPS[mode];
        var stack = [];
        var n;
        for (var at = start; (n = memo.get(at)) === undefined; at += g.len) {
            if (at + g.len > capacity || !consistent(at, g.len, 0, g.max)) {
                n = 0;
                memo.set(at, 0);
                break;
            }
            stack.push(at);
        }
        for (var i = stack.length - 1; i >= 0; i--)
            memo.set(stack[i], ++n);
        return memo.get(start);
    }

    // Data fields of a segment overlapping bits[lo, hi), passed to each(start, len, lo, hi)
    grammar.dataFields = function (mode, start, count, lo, hi, each) {
        var g = GROUPS[mode];
        if (!g)
            return;
        var full = Math.floor(count / g.chars);
        var first = Math.max(0, Math.floor((lo - start) / g.len));
        var last = Math.min(full - 1, Math.floor((hi - 1 - start) / g.len));
        for (var i = first; i <= last; i++)
            each(start + i * g.len, g.len, 0, g.max);
        var rest = g.rest[count % g.chars];
        if (rest && start + full * g.len < hi && start + full * g.len + rest[0] > lo)
            each(start + full * g.len, rest[0], 0, rest[1]);
    };

    function dataOk(mode, start, count) {
        var g = GROUPS[mode];
        if (!g)
            return true;
        var full = Math.floor(count / g.chars);
        var rest = g.rest[count % g.chars];
        return fullGroups(mode, start) >= full && (!rest || consistent(start + full * g.len, rest[0], 0, rest[1]));
    }

    // Fields of a segment overlapping bits[lo, hi)
    grammar.segmentFields = function (s, lo, hi) {
        var fields = [];
        function add(start, len, min, max) {
            if (start < hi && start + len > lo)
                fields.push({ start: start, len: len, lo: min, hi: max });
        }
        if (s.mode == "0111") {
            add(s.pos, 4, 7, 7);
            add(s.pos + 4, s.prefix[0], s.prefix[1], s.prefix[1]);
        } else {
            var mode = parseInt(s.mode, 2);
            add(s.pos, 4, mode, mode);
            add(s.pos + 4, s.count_bits, s.count, s.count);
            grammar.dataFields(s.mode, s.start, s.count, lo, hi, add);
        }
        return fields;
    };

    // Call fn for every segment that can start at pos; stops when fn returns true.
    // A segment is { mode, pos, count_bits, count, start (of its data), end }, or for ECI { mode, pos, prefix, start, end }
    var MODES = ["0001", "0010", "0100", "1000"];
    var ECI = [[1, 0, 8], [2, 2, 16], [3, 6, 24]];
    grammar.forEachSegment = function (pos, fn) {
        var remaining = capacity - pos;
        for (var m = 0; m < MODES.length; m++) {
            var mode = parseInt(MODES[m], 2);
            var count_bits = getCharCountBits(MODES[m], version);
            if (remaining < 4 + count_bits || !consistent(pos, 4, mode, mode))
                continue;
            var data_start = pos + 4 + count_bits;
            var counts = srMatchingValues(srKnown(bits, pos + 4, count_bits), count_bits, 1, (1 << count_bits) - 1);
            for (var c = 0; c < counts.length; c++) {
                tick();
                var end = data_start + getSegmentDataBits(MODES[m], counts[c]);
                if (end > capacity)
                    break;
                if (dataOk(MODES[m], data_start, counts[c]) &&
                    fn({ mode: MODES[m], pos: pos, count_bits: count_bits, count: counts[c], start: data_start, end: end }))
                    return true;
            }
        }
        // ECI: the designator is 8, 16 or 24 bits long, told apart by its first bits
        for (var e = 0; e < ECI.length; e++) {
            var eci_end = pos + 4 + ECI[e][2];
            if (eci_end <= capacity && consistent(pos, 4, 7, 7) && consistent(pos + 4, ECI[e][0], ECI[e][1], ECI[e][1]) &&
                fn({ mode: "0111", pos: pos, prefix: ECI[e], start: pos + 4 + ECI[e][0], end: eci_end }))
                return true;
        }
        return false;
    };

    // valid_memo[pos]: -1 not computed yet, 0 no complete parse from pos, 1 there is one
    var valid_memo = new Int8Array(capacity + 1).fill(-1);
    grammar.valid = function (pos) {
        if (valid_memo[pos] < 0) {
            var ok = grammar.terminatorOk(pos) || grammar.forEachSegment(pos, function (s) { return grammar.valid(s.end); });
            valid_memo[pos] = ok ? 1 : 0;
        }
        return valid_memo[pos] == 1;
    };

    return grammar;
}

/*
    Enumerate every complete parse of the data sequence that agrees with the known bits,
    calling onStructure(fields, segments) for each one. Meant for mostly known sequences:
    the number of parses grows quickly with unknown bits.
*/
function srParseStructures(bits, version, onStructure, limits) {

    var grammar = srGrammar(bits, version, limits);
    var capacity = bits.length;
    var fields = [];
    var segments = [];
    var state = { structures: 0, truncated: false };

    function push(start, len, lo, hi) {
        fields.push({ start: start, len: len, lo: lo, hi: hi });
    }

    function walk(pos) {
        if (state.structures >= limits.structures)
            throw grammar.truncated;
        var depth = fields.length;

        if (grammar.terminatorOk(pos)) {
            var zeros = grammar.terminatorZeros(pos);
            if (zeros)
                push(pos, zeros, 0, 0);
            for (var p = pos + zeros, i = 0; p < capacity; p += 8, i ^= 1)
                push(p, 8, SR_PAD_BYTES[i], SR_PAD_BYTES[i]);
            state.structures++;
            onStructure(fields, segments);
            fields.length = depth;
        }

        grammar.forEachSegment(pos, function (s) {
            if (!grammar.valid(s.end))
                return false;
            fields.push.apply(fields, grammar.segmentFields(s, 0, capacity));
            if (s.mode != "0111")
                segments.push({ mode: s.mode, start: s.start, count: s.count });
            walk(s.end);
            if (s.mode != "0111")
                segments.pop();
            fields.length = depth;
            return false;
        });
    }

    try {
        if (grammar.valid(0))
            walk(0);
    } catch (e) {
        if (e !== grammar.truncated)
            throw e;
        state.truncated = true;
    }

    return state;
}

/*
    Candidate values of the given data codewords according to the grammar: the union, over
    every complete parse, of the values that parse allows. masks is null when the grammar can't
    be used (no parse agrees with the known bits, or the work limit was reached).

    The parses aren't enumerated. A segment is live when it is reachable from the start and a
    complete parse exists from its end; every live segment belongs to some complete parse.
    A codeword takes its values from the live segments covering it. When a segment boundary
    falls inside a codeword, what comes before and after it are independent, so the codeword
    allows any left part from a live segment ending there combined with any right part from
    a live segment starting there.
*/
function srGrammarCandidates(bits, version, targets, limits) {

    var grammar = srGrammar(bits, version, limits);
    var capacity = bits.length;
    var codewords = capacity / 8;

    var is_target = new Uint8Array(codewords);
    for (var t = 0; t < targets.length; t++)
        is_target[targets[t]] = 1;

    var free_runs = new Int32Array(codewords + 1);   // difference array of codewords inside byte data
    var pad_start = [Infinity, Infinity];            // earliest live padding start, by byte parity
    var applied = {};
    var part_memo = new Map();
    var live = 0;

    // Possible values of bits[lo, hi) of codeword k: the whole codeword, or the part before
    // (lo == 8k) or after (hi == 8k + 8) a segment boundary. Full once it holds every value
    // that agrees with the known bits, and then touching it again changes nothing.
    var slots = {};
    function slot(k, lo, hi) {
        var id = (k * 8 + lo - 8 * k) * 9 + hi - 8 * k;
        if (!slots[id]) {
            var values = srMatchingValues(srKnown(bits, lo, hi - lo), hi - lo, 0, (1 << (hi - lo)) - 1);
            slots[id] = { set: new Uint8Array(256), count: 0, values: values };
        }
        return slots[id];
    }

    function full(s) {
        return s.count == s.values.length;
    }

    function fieldKey(f) {
        return f.start + ":" + f.len + ":" + f.lo + ":" + f.hi;
    }

    // Possible values of bits[a, b) of a field
    function partSet(f, a, b) {
        var field = ((f.start * 32 + f.len) * 65536 + f.lo) * 65536 + f.hi;
        var memo = part_memo.get(field);
        if (!memo)
            part_memo.set(field, memo = {});
        var key = (a - f.start) * 32 + b - a;
        if (!memo[key]) {
            var values = f.lo == f.hi ? [f.lo] : srMatchingValues(srKnown(bits, f.start, f.len), f.len, f.lo, f.hi);
            var shift = f.start + f.len - b;
            var part_mask = (1 << (b - a)) - 1;
            var set = new Uint8Array(1 << (b - a));
            for (var i = 0; i < values.length; i++)
                set[(values[i] >> shift) & part_mask] = 1;
            memo[key] = set;
        }
        return memo[key];
    }

    // Record the possible values of bits[lo, hi) of codeword k under the given fields
    function touch(k, lo, hi, fields) {
        var target = slot(k, lo, hi);
        if (full(target))
            return;
        var key = k + "|" + lo + "|" + hi + "|" + fields.map(fieldKey).join(",");
        if (applied[key])
            return;
        applied[key] = true;

        var checks = fields.map(function (f) {
            var a = Math.max(f.start, lo);
            var b = Math.min(f.start + f.len, hi);
            return { shift: hi - b, mask: (1 << (b - a)) - 1, set: partSet(f, a, b) };
        });

        var values = target.values;
        for (var i = 0; i < values.length; i++) {
            var ok = target.set[values[i]] == 0;
            for (var j = 0; j < checks.length && ok; j++)
                ok = checks[j].set[(values[i] >> checks[j].shift) & checks[j].mask] == 1;
            if (ok) {
                target.set[values[i]] = 1;
                target.count++;
            }
        }
    }

    // Touch every codeword in [k_from, k_to] with the part of the segment covering it
    function touchSegment(s, k_from, k_to) {
        for (var k = k_from; k <= k_to; k++) {
            var lo = Math.max(8 * k, s.pos);
            var hi = Math.min(8 * k + 8, s.end);
            if (is_target[k] && lo < hi && !full(slot(k, lo, hi)))
                touch(k, lo, hi, grammar.segmentFields(s, lo, hi));
        }
    }

    // Live segments of the same mode starting at the same position share everything but the
    // character count and the last codewords, so their middle is handled once
    function addSegments(segments) {
        var longest = segments[segments.length - 1];
        var first_data = Math.floor(longest.start / 8);
        var middle_end = first_data;
        for (var i = 0; i < segments.length; i++) {
            var s = segments[i];
            var last = Math.floor((s.end - 1) / 8);
            var tail = Math.max(first_data + 1, last - 2);
            touchSegment(s, Math.floor(s.pos / 8), first_data);
            touchSegment(s, tail, last);
            middle_end = Math.max(middle_end, tail);
        }

        // Codewords strictly between the header and the tails
        if (middle_end > first_data + 1) {
            if (longest.mode == "0001" || longest.mode == "0010") {
                touchSegment(longest, first_data + 1, middle_end - 1);
            } else {
                free_runs[first_data + 1]++;
                free_runs[middle_end]--;
            }
        }
        live += segments.length;
    }

    var reach = new Uint8Array(capacity + 1);
    reach[0] = 1;
    try {
        for (var pos = 0; pos <= capacity; pos++) {
            if (!reach[pos] || !grammar.valid(pos))
                continue;

            if (grammar.terminatorOk(pos)) {
                var zeros = grammar.terminatorZeros(pos);
                var terminator = [{ start: pos, len: zeros, lo: 0, hi: 0 }];
                for (var k = Math.floor(pos / 8); k * 8 < pos + zeros; k++) {
                    var lo = Math.max(8 * k, pos);
                    var hi = Math.min(8 * k + 8, pos + zeros);
                    if (is_target[k] && lo < hi)
                        touch(k, lo, hi, terminator);
                }
                var pad = (pos + zeros) / 8;
                if (pad < codewords)
                    pad_start[pad & 1] = Math.min(pad_start[pad & 1], pad);
                live++;
            }

            var by_mode = {};
            grammar.forEachSegment(pos, function (s) {
                if (grammar.valid(s.end)) {
                    reach[s.end] = 1;
                    (by_mode[s.mode] = by_mode[s.mode] || []).push(s);
                }
                return false;
            });
            for (var mode in by_mode)
                addSegments(by_mode[mode]);
        }
    } catch (e) {
        if (e !== grammar.truncated)
            throw e;
        return { masks: null, live: live, truncated: true };
    }

    if (!reach[0] || !grammar.valid(0))
        return { masks: null, live: 0, truncated: false };

    var masks = {};
    var run = 0;
    for (var k = 0; k < codewords; k++) {
        run += free_runs[k];
        if (!is_target[k])
            continue;
        var whole = slot(k, 8 * k, 8 * k + 8);
        var mask = masks[k] = whole.set;
        var values = whole.values;

        // Inside byte data: anything goes
        if (run > 0) {
            for (var i = 0; i < values.length; i++)
                mask[values[i]] = 1;
            continue;
        }

        // Padding: the pad byte depends on the parity of where the padding started
        for (var p = 0; p < 2; p++) {
            if (pad_start[p] <= k)
                mask[SR_PAD_BYTES[(k - p) & 1]] = 1;
        }

        // A segment boundary inside the codeword
        for (var offset = 1; offset < 8; offset++) {
            var before = slots[(k * 8) * 9 + offset];
            var after = slots[(k * 8 + offset) * 9 + 8];
            if (!before || !after)
                continue;
            for (var i = 0; i < values.length; i++) {
                var v = values[i];
                if (before.set[v >> (8 - offset)] && after.set[v & ((1 << (8 - offset)) - 1)])
                    mask[v] = 1;
            }
        }
    }

    return { masks: masks, live: live, truncated: false };
}

/*
    Solve one Reed-Solomon block. candidates[j] lists the possible values of codeword j
    (a single value when it is known). The parity equations are reduced by Gauss-Jordan
    elimination: unknowns with the most candidates become pivots, and the search runs over
    the remaining (free) unknowns, keeping the assignments where every pivot lands inside
    its own candidates.
*/
function srSolveBlock(candidates, nysm, limits) {

    var n = candidates.length;
    var result = { status: "no_solution", solutions: [], count: 0, total: 0 };

    var unknown = [];
    for (var j = 0; j < n; j++) {
        if (candidates[j].length == 0)
            return result;
        if (candidates[j].length > 1)
            unknown.push(j);
    }
    unknown.sort(function (x, y) { return candidates[y].length - candidates[x].length; });
    var f = unknown.length;

    // Parity check: sum of c_j * alpha^(i * (n - 1 - j)) = 0, for i < nysm
    var M = [];
    for (var i = 0; i < nysm; i++) {
        var row = [];
        for (var c = 0; c < f; c++)
            row.push(gf_exp[(i * (n - 1 - unknown[c])) % 255]);
        var rhs = 0;
        for (var j = 0; j < n; j++) {
            if (candidates[j].length == 1)
                rhs ^= gf_mul(gf_exp[(i * (n - 1 - j)) % 255], candidates[j][0]);
        }
        row.push(rhs);
        M.push(row);
    }

    var pivots = [];
    var is_pivot = [];
    var r = 0;
    for (var c = 0; c < f && r < nysm; c++) {
        var p = r;
        while (p < nysm && M[p][c] == 0)
            p++;
        if (p == nysm)
            continue;

        var tmp = M[p];
        M[p] = M[r];
        M[r] = tmp;

        var inv = gf_inverse(M[r][c]);
        for (var k = 0; k <= f; k++)
            M[r][k] = gf_mul(M[r][k], inv);
        for (var i = 0; i < nysm; i++) {
            if (i != r && M[i][c] != 0) {
                var factor = M[i][c];
                for (var k = 0; k <= f; k++)
                    M[i][k] ^= gf_mul(factor, M[r][k]);
            }
        }

        pivots.push({ row: r, col: c });
        is_pivot[c] = true;
        r++;
    }

    // Leftover equations must read 0 = 0
    for (var i = r; i < nysm; i++) {
        if (M[i][f] != 0)
            return result;
    }

    var free_cols = [];
    for (var c = 0; c < f; c++) {
        if (!is_pivot[c])
            free_cols.push(c);
    }

    var total = 1;
    for (var q = 0; q < free_cols.length; q++)
        total *= candidates[unknown[free_cols[q]]].length;
    result.total = total;
    if (total > limits.search) {
        result.status = "too_large";
        return result;
    }

    var allowed = pivots.map(function (p) {
        var set = new Uint8Array(256);
        candidates[unknown[p.col]].forEach(function (v) { set[v] = 1; });
        return set;
    });
    var free_candidates = free_cols.map(function (c) { return candidates[unknown[c]]; });
    var coef = pivots.map(function (p) {
        return free_cols.map(function (c) { return M[p.row][c]; });
    });
    // coef * value lookup tables for the inner loop
    var mul = coef.map(function (row) {
        return row.map(function (a) {
            var table = new Uint8Array(256);
            for (var v = 1; v < 256; v++)
                table[v] = gf_mul(a, v);
            return table;
        });
    });

    var F = free_cols.length;
    var idx = [];
    var x = [];
    for (var q = 0; q < F; q++) {
        idx.push(0);
        x.push(free_candidates[q][0]);
    }
    var pv = pivots.map(function (p, pi) {
        var v = M[p.row][f];
        for (var q = 0; q < F; q++)
            v ^= gf_mul(coef[pi][q], x[q]);
        return v;
    });

    // Odometer over the free unknowns, updating the pivots incrementally
    while (true) {
        var ok = true;
        for (var pi = 0; pi < pv.length && ok; pi++)
            ok = allowed[pi][pv[pi]] == 1;

        if (ok) {
            result.count++;
            if (result.solutions.length < limits.solutions) {
                var solution = candidates.map(function (values) { return values[0]; });
                for (var q = 0; q < F; q++)
                    solution[unknown[free_cols[q]]] = x[q];
                for (var pi = 0; pi < pv.length; pi++)
                    solution[unknown[pivots[pi].col]] = pv[pi];
                result.solutions.push(solution);
            }
        }

        var q = 0;
        for (; q < F; q++) {
            var old = x[q];
            idx[q] = (idx[q] + 1) % free_candidates[q].length;
            x[q] = free_candidates[q][idx[q]];
            var delta = old ^ x[q];
            if (delta) {
                for (var pi = 0; pi < pv.length; pi++)
                    pv[pi] ^= mul[pi][q][delta];
            }
            if (idx[q] != 0)
                break;
        }
        if (q == F)
            break;
    }

    if (result.count == 1)
        result.status = "solved";
    else if (result.count > 1)
        result.status = "ambiguous";

    return result;
}

// Text of the parsed segments, and a score that favours printable text
function srDecodeSegments(bits, segments) {

    var text = "";
    var score = 0;
    var unknown = "�";

    for (var s = 0; s < segments.length; s++) {
        var segment = segments[s];
        var pos = segment.start;

        if (segment.mode == "0100") {
            for (var i = 0; i < segment.count; i++, pos += 8) {
                var byte = bits.substring(pos, pos + 8);
                if (byte.indexOf("?") != -1) {
                    text += unknown;
                    continue;
                }
                var v = parseInt(byte, 2);
                text += String.fromCharCode(v);
                if ((v >= 0x20 && v < 0x7F) || v == 0x09 || v == 0x0A || v == 0x0D)
                    score++;
                else if (v < 0x20 || v == 0x7F)
                    score--;
            }

        } else if (segment.mode == "0001" || segment.mode == "0010") {
            var numeric = segment.mode == "0001";
            var left = segment.count;
            while (left > 0) {
                var chars = numeric ? Math.min(3, left) : Math.min(2, left);
                var len = numeric ? [0, 4, 7, 10][chars] : [0, 6, 11][chars];
                var group = bits.substring(pos, pos + len);
                pos += len;
                left -= chars;

                if (group.indexOf("?") != -1) {
                    text += new Array(chars + 1).join(unknown);
                    continue;
                }
                var v = parseInt(group, 2);
                if (numeric)
                    text += String(v).padStart(chars, "0");
                else if (chars == 2)
                    text += alphanumeric_table[Math.floor(v / 45)] + alphanumeric_table[v % 45];
                else
                    text += alphanumeric_table[v];
                score += chars;
            }

        } else {
            text += new Array(segment.count + 1).join(unknown);
        }
    }

    return { text: text, score: score };
}

// Best reading of a data sequence, or null when it can't be parsed
function srReadMessage(bits, version) {

    var best = null;
    srParseStructures(bits, version, function (fields, segments) {
        var read = srDecodeSegments(bits, segments);
        if (best == null || read.score > best.score)
            best = read;
    }, { structures: 64, visits: 20000 });

    return best;
}

function srToBits(value) {
    return ("00000000" + value.toString(2)).slice(-8);
}

/*
    About how many unknown modules must still be identified in a block before it can be
    solved: the candidates hold more possibilities than the parity can check (sum of log2 of
    the candidate counts against 8 bits per error correction codeword), or the search over
    the free unknowns is over the limit. Each identified module removes about one bit.
*/
function srModulesNeeded(candidates, nysm, limits) {

    var bits = candidates
        .filter(function (values) { return values.length > 1; })
        .map(function (values) { return Math.log2(values.length); })
        .sort(function (x, y) { return x - y; });
    var sum = function (list) { return list.reduce(function (t, x) { return t + x; }, 0); };
    var free = bits.slice(0, Math.max(0, bits.length - nysm));

    return Math.max(1, Math.ceil(sum(bits) - 8 * nysm), Math.ceil(sum(free) - Math.log2(limits.search)));
}

/*
    Recovered codewords narrow down the others (e.g. once the end of the message is known,
    the padding of other blocks is too), so passes are repeated while they recover more.
*/
function smartRecovery(data_array, limits) {

    limits = limits || SR_LIMITS;

    var pass = srRecoverPass(data_array, limits);
    if (typeof pass == "string")
        return pass;

    var first = pass;
    var lines = pass.lines.slice();
    for (var round = 2; round <= 10 && pass.status.indexOf("open") != -1; round++) {
        var next = srRecoverPass(pass.result_array, limits);
        if (typeof next == "string" || next.after == pass.after)
            break;
        for (var b = 0; b < lines.length; b++) {
            if (next.status[b] == "recovered")
                lines[b] = next.lines[b] + " (round " + round + ", using the codewords recovered before)";
            else if (next.status[b] == "open")
                lines[b] = next.lines[b];
        }
        pass = next;
    }

    var info = first.header.concat(lines);
    if (pass.message)
        info.push(pass.message);

    return {
        result_array: pass.result_array,
        before: first.before,
        after: pass.after,
        info: info.join("\n")
    };
}

// One recovery pass. Each block ends "nothing" (no unknown codeword), "recovered" or "open"
function srRecoverPass(data_array, limits) {

    var width = data_array.length;
    var version = (width - 21) / 4 + 1;
    var format_info = getFormatInfo(data_array);
    if (!format_info.known)
        return "ERROR: Unknown format information (error correction level and mask pattern). Recover it first, e.g. with Brute-force Format Info Pattern";

    var ecc = format_info.ecc;
    var mask_pattern = format_info.mask;
    var data = maskData(data_array, mask_pattern);
    var rs_blocks = readRSBlocks(data, version, ecc);
    var nysm = error_correction_code_table[version - 1][ecc];
    var header = [];
    var lines = [];
    var status = [];

    header.push("Version " + version + "-" + ["M", "L", "H", "Q"][ecc] + ": " + rs_blocks.length + " block(s), "
        + nysm + " error correction codewords per block");

    // Data sequence, and the data codewords with unknown bits
    var data_bits = "";
    var targets = [];
    var g = 0;
    for (var b = 0; b < rs_blocks.length; b++) {
        for (var j = 0; j < rs_blocks[b].data.length; j++, g++) {
            if (rs_blocks[b].data[j].bits.indexOf("?") != -1)
                targets.push(g);
            data_bits += rs_blocks[b].data[j].bits;
        }
    }

    var grammar = srGrammarCandidates(data_bits, version, targets, limits);
    if (grammar.masks)
        header.push("Grammar: " + grammar.live + " possible segment(s) and message end(s) agree with the known bits");
    else if (grammar.truncated)
        header.push("Grammar: too many possibilities to analyze, not used");
    else
        header.push("Grammar: no parse of the data sequence matches the known bits, not used");

    var solutions = [];
    g = 0;
    for (var b = 0; b < rs_blocks.length; b++) {
        var block = rs_blocks[b];
        var codewords = block.data.concat(block.ec);
        var by_bits = codewords.map(function (cw) {
            return srMatchingValues(srKnown(cw.bits, 0, 8), 8, 0, 255);
        });
        var by_grammar = by_bits.map(function (values, j) {
            var mask = grammar.masks && j < block.data.length ? grammar.masks[g + j] : null;
            if (!mask)
                return values;
            var allowed = [];
            for (var v = 0; v < 256; v++) {
                if (mask[v])
                    allowed.push(v);
            }
            return allowed;
        });
        g += block.data.length;

        var unknown = by_bits.filter(function (values) { return values.length > 1; }).length;
        var line = "Block " + (b + 1) + ": " + unknown + " unknown codeword(s)";
        if (unknown == 0) {
            solutions.push([by_bits.map(function (values) { return values[0]; })]);
            lines.push(line + ", nothing to recover");
            status.push("nothing");
            continue;
        }

        var left = by_grammar.filter(function (values) { return values.length > 1; }).length;
        if (left < unknown)
            line += ", " + (unknown - left) + " fixed by the grammar";

        var res = srSolveBlock(by_grammar, nysm, limits);
        if (res.status == "no_solution" && grammar.masks) {
            res = srSolveBlock(by_bits, nysm, limits);
            if (res.status != "no_solution")
                line += " (grammar ignored)";
        }
        if (res.status == "no_solution" && unknown <= nysm) {
            // Some known modules are probably wrong: let RS correct errors too
            var erasures = [];
            var msg = by_bits.map(function (values, j) {
                if (values.length > 1)
                    erasures.push(j);
                return values.length == 1 ? values[0] : 0;
            });
            // The decoder can throw on some inputs instead of returning an error message
            var decoded;
            try {
                decoded = RS.decode(msg, nysm, erasures);
            } catch (e) {
                decoded = String(e);
            }
            if (typeof decoded != "string") {
                res = { status: "solved", solutions: [RS.encode(decoded, nysm)], count: 1 };
                line += " (corrected as errors and erasures)";
            }
        }

        // Only rank complete solution lists: a missing solution could be the right one
        var complete = res.count == res.solutions.length;
        // A lower bound: in tests, revealing twice as many random unknown modules always solved the block
        var at_least = srModulesNeeded(by_grammar, nysm, limits);
        var needed = "identify " + at_least + " to " + 2 * at_least + " more module(s) of this block and run it again";
        if (res.status == "solved")
            line += ", solved";
        else if (res.status == "ambiguous" && complete)
            line += ", " + res.count + " possible solutions";
        else if (res.status == "ambiguous")
            line += ", " + res.count + " possible solutions, too many to rank: block left unchanged, " + needed;
        else if (res.status == "too_large")
            line += ", search too large (" + res.total + " combinations): block left unchanged, " + needed;
        else
            line += ", no solution: some known modules are probably wrong";
        lines.push(line);

        solutions.push(res.solutions.length && complete ? res.solutions : null);
        status.push(solutions[b] ? "recovered" : "open");
    }

    // Pick a solution per block, preferring the most readable message
    var choice = solutions.map(function () { return 0; });

    function assemble() {
        var bits = "";
        for (var b = 0; b < rs_blocks.length; b++) {
            for (var j = 0; j < rs_blocks[b].data.length; j++)
                bits += solutions[b] ? srToBits(solutions[b][choice[b]][j]) : rs_blocks[b].data[j].bits;
        }
        return bits;
    }

    // Readability means little while part of the message is still unknown
    var unsolved = solutions.some(function (list) { return list == null; });

    for (var b = 0; b < solutions.length; b++) {
        if (!solutions[b] || solutions[b].length < 2)
            continue;
        if (unsolved) {
            lines[b] += ": can't pick one while other blocks are unknown, block left unchanged";
            solutions[b] = null;
            status[b] = "open";
            continue;
        }
        var best_score = -Infinity;
        var best = 0;
        var ties = 0;
        for (var s = 0; s < solutions[b].length; s++) {
            choice[b] = s;
            var read = srReadMessage(assemble(), version);
            var score = read ? read.score : -Infinity;
            if (score > best_score) {
                best_score = score;
                best = s;
                ties = 1;
            } else if (score == best_score) {
                ties++;
            }
        }
        choice[b] = best;
        if (ties > 1) {
            solutions[b] = null;
            status[b] = "open";
            lines[b] += ": " + ties + " are equally plausible, block left unchanged";
        } else {
            lines[b] += ": picked the one with the most readable text";
        }
    }

    var final_bits = assemble();
    var message = srReadMessage(final_bits, version);
    if (message)
        message = (final_bits.indexOf("?") == -1 ? "Message: " : "Message (partial): ") + message.text;

    // Write the recovered codewords back into the modules
    var before = "";
    var after = "";
    var parts = ["data", "ec"];
    for (var p = 0; p < parts.length; p++) {
        for (var b = 0; b < rs_blocks.length; b++) {
            var offset = parts[p] == "data" ? 0 : rs_blocks[b].data.length;
            var codewords = rs_blocks[b][parts[p]];
            for (var j = 0; j < codewords.length; j++) {
                var bits = solutions[b] ? srToBits(solutions[b][choice[b]][offset + j]) : codewords[j].bits;
                before += codewords[j].bits;
                after += bits;
                for (var i = 0; i < 8; i++) {
                    var cord = codewords[j].modules[i].split("-");
                    data[cord[0]][cord[1]] = bits.charAt(i) == "?" ? -1 : parseInt(bits.charAt(i));
                }
            }
        }
    }

    return {
        result_array: maskData(data, mask_pattern),
        before: before,
        after: after,
        header: header,
        lines: lines,
        status: status,
        message: message
    };
}
