/** Tell MIDI lists to reload (after a clip was made somewhere else on the page). */
export const MIDI_CHANGED = "aegis:midi-changed";
export const midiChanged = () => window.dispatchEvent(new Event(MIDI_CHANGED));
