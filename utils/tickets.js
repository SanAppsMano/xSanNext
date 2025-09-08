export const KEY = (empresa, tipo) => `queue:${empresa}:${tipo}`; // tipo = 'preferencial' | 'normal'

export function toScore(numOuStr) {
  // aceita "P2", "N10", "002", etc.
  const m = String(numOuStr).match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

export function toMember(tipo, numero) {
  // mantém legibilidade no member
  const n = toScore(numero);
  return `${tipo === 'preferencial' ? 'P' : 'N'}:${n}`;
}
