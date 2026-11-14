// Estrutura do banco (Cloudflare D1). As tabelas são criadas sozinhas no primeiro acesso.

const TABELAS = [
  `CREATE TABLE IF NOT EXISTS personais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    senha_sal TEXT NOT NULL,
    pix_tipo TEXT,
    pix_chave TEXT,
    pix_nome TEXT,
    pix_cidade TEXT,
    valor_padrao INTEGER,
    dia_padrao INTEGER DEFAULT 5,
    tom TEXT DEFAULT 'zoeiro',
    foto TEXT,
    criado_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessoes (
    token TEXT PRIMARY KEY,
    personal_id INTEGER NOT NULL,
    expira_em INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS alunos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    personal_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    mes_inicio TEXT,
    meses_pausa INTEGER DEFAULT 0,
    base_meses INTEGER NOT NULL DEFAULT 1,
    seq_base INTEGER NOT NULL DEFAULT 0,
    mes_cadastro TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'novo',
    valor INTEGER,
    dia_venc INTEGER,
    lembrado_em TEXT,
    criado_em TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS alunos_por_personal ON alunos (personal_id)`,
  `CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aluno_id INTEGER NOT NULL,
    mes TEXT NOT NULL,
    status TEXT NOT NULL,
    informado_em TEXT,
    confirmado_em TEXT,
    UNIQUE (aluno_id, mes)
  )`,
  `CREATE TABLE IF NOT EXISTS frases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    personal_id INTEGER NOT NULL,
    texto TEXT NOT NULL,
    ativa INTEGER NOT NULL DEFAULT 1,
    origem TEXT NOT NULL DEFAULT 'padrao'
  )`,
];

const COLUNAS_NOVAS = ['ALTER TABLE personais ADD COLUMN recuperacao_hash TEXT'];

let pronto = false;

export async function prepararBanco(db) {
  if (pronto) return;
  await db.batch(TABELAS.map((sql) => db.prepare(sql)));
  // Colunas adicionadas depois da primeira versão. Se já existirem, o erro é ignorado.
  for (const sql of COLUNAS_NOVAS) {
    try {
      await db.prepare(sql).run();
    } catch {
      /* coluna já existe */
    }
  }
  pronto = true;
}

// {personal} vira o primeiro nome do personal e {meses} os meses de treino do aluno.
export const FRASES_PADRAO = [
  'Mais um mês aguentando {personal}.',
  '{meses} meses e {personal} ainda não desistiu de mim.',
  'Paguei para sofrer mais 30 dias. De nada, {personal}.',
  '{personal} disse “só mais uma”. Isso faz {meses} meses.',
  'Renovado: mais um mês ouvindo “tá fácil, vai!”',
  'Minha evolução agradece. Minhas pernas, não.',
];
