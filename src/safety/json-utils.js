function tryParse(text) {
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (error) {
        return { ok: false, error };
    }
}

function assertObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Model response is not a JSON object');
    }
    return value;
}

/**
 * Extracts a JSON object from a model reply.
 * Only strips a markdown fence that wraps the WHOLE reply, so ``` inside
 * string values (e.g. a README written by the model) is left intact.
 */
export function parseModelJson(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        throw new Error('Empty model response');
    }

    const text = raw.trim();
    let result = tryParse(text);
    if (result.ok) return assertObject(result.value);

    const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    result = tryParse(unfenced);
    if (result.ok) return assertObject(result.value);

    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) {
        throw new Error('No JSON object found in model response');
    }
    result = tryParse(unfenced.slice(start, end + 1));
    if (result.ok) return assertObject(result.value);
    throw result.error;
}
