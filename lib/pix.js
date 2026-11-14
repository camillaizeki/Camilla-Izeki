// Gera o "Pix copia e cola" (BR Code estático) a partir da chave do personal.
// É um padrão público do Banco Central: não depende de banco nem de provedor.

function campo(id, valor) {
  const tamanho = String(valor.length).padStart(2, '0');
  return id + tamanho + valor;
}

export function crc16(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function semAcento(texto, limite) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, limite);
}

// Deixa a chave no formato que os bancos esperam.
export function normalizarChave(tipo, chave) {
  const bruta = String(chave || '').trim();
  if (tipo === 'email') return bruta.toLowerCase();
  if (tipo === 'celular') {
    let digitos = bruta.replace(/\D/g, '');
    if (digitos.length === 10 || digitos.length === 11) digitos = '55' + digitos;
    return '+' + digitos;
  }
  if (tipo === 'cpf_cnpj') return bruta.replace(/\D/g, '');
  return bruta.toLowerCase(); // chave aleatória
}

export function gerarPix({ chave, nome, cidade, centavos, txid }) {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
  const id = String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  let codigo =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986');
  if (centavos > 0) codigo += campo('54', (centavos / 100).toFixed(2));
  codigo +=
    campo('58', 'BR') +
    campo('59', semAcento(nome, 25) || 'RECEBEDOR') +
    campo('60', semAcento(cidade, 15) || 'BRASIL') +
    campo('62', campo('05', id)) +
    '6304';
  return codigo + crc16(codigo);
}
