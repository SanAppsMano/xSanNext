export const KEY_ZSET = (empresa, tipo) => `queue:${empresa}:${tipo}`; // 'preferencial' | 'normal'
export const KEY_TICKET = (empresa, numero) => `ticket:${empresa}:${numero}`;
export const KEY_SEQ = (empresa) => `queue:${empresa}:seq`; // contador global sequencial

export function parseTipoFromRow(row) {
  // Se vier como { preferencial: true/false }, use isso.
  // Se vier no texto com "*", trata aqui.
  if (typeof row.preferencial === 'boolean') return row.preferencial ? 'preferencial' : 'normal';
  const nome = (row.nome || '').toString();
  return /\*/.test(nome) ? 'preferencial' : 'normal';
}

export function cleanNome(row) {
  return (row.nome || '').toString().replace(/\*/g, '').trim();
}
