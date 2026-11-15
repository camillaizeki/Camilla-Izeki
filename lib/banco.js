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

// Tabelas acrescentadas depois da primeira versão.
const TABELAS_NOVAS = [
  `CREATE TABLE IF NOT EXISTS pausas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aluno_id INTEGER NOT NULL,
    inicio TEXT NOT NULL,
    fim TEXT,
    cobrar INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT)`,
];

// Colunas acrescentadas depois da primeira versão. Se já existirem, o erro é ignorado.
const COLUNAS_NOVAS = [
  'ALTER TABLE personais ADD COLUMN recuperacao_hash TEXT',
  'ALTER TABLE alunos ADD COLUMN data_inicio TEXT', // AAAA-MM-DD
  'ALTER TABLE alunos ADD COLUMN mes_controle TEXT', // primeiro mês com mensalidade controlada
  'ALTER TABLE alunos ADD COLUMN gerar_desde TEXT', // retomada depois de um período inativo
  'ALTER TABLE pagamentos ADD COLUMN valor_previsto INTEGER',
  'ALTER TABLE pagamentos ADD COLUMN vencimento TEXT', // AAAA-MM-DD
  'ALTER TABLE pagamentos ADD COLUMN recebido_em TEXT', // data real do recebimento
  'ALTER TABLE pagamentos ADD COLUMN valor_recebido INTEGER',
];

// Conversão dos dados da primeira versão para o controle de mensalidades (roda uma única vez).
// Nada é apagado: só preenche o que faltava.
const VERSAO = '2';
const CONVERSAO = [
  "UPDATE alunos SET mes_controle = strftime('%Y-%m', mes_cadastro || '-01', '+1 month') WHERE mes_controle IS NULL AND status != 'novo'",
  "UPDATE alunos SET data_inicio = mes_inicio || '-01' WHERE data_inicio IS NULL AND mes_inicio IS NOT NULL",
  "INSERT INTO pausas (aluno_id, inicio, cobrar) SELECT id, date('now', '-3 hours'), 0 FROM alunos WHERE status = 'pausado'",
  "UPDATE alunos SET status = 'ativo' WHERE status = 'pausado'",
  'UPDATE pagamentos SET valor_previsto = (SELECT valor FROM alunos WHERE alunos.id = pagamentos.aluno_id) WHERE valor_previsto IS NULL',
  "UPDATE pagamentos SET vencimento = mes || '-' || printf('%02d', COALESCE((SELECT dia_venc FROM alunos WHERE alunos.id = pagamentos.aluno_id), 5)) WHERE vencimento IS NULL",
  "UPDATE pagamentos SET recebido_em = substr(confirmado_em, 1, 10) WHERE status = 'confirmado' AND recebido_em IS NULL",
  "UPDATE pagamentos SET valor_recebido = valor_previsto WHERE status = 'confirmado' AND valor_recebido IS NULL",
  "INSERT INTO meta (chave, valor) VALUES ('versao', '2') ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor",
];

let pronto = false;

export async function prepararBanco(db) {
  if (pronto) return;
  await db.batch([...TABELAS, ...TABELAS_NOVAS].map((sql) => db.prepare(sql)));
  const meta = await db.prepare("SELECT valor FROM meta WHERE chave = 'versao'").first();
  if (!meta || meta.valor !== VERSAO) {
    for (const sql of COLUNAS_NOVAS) {
      try {
        await db.prepare(sql).run();
      } catch {
        /* coluna já existe */
      }
    }
    await db.batch(CONVERSAO.map((sql) => db.prepare(sql)));
  }
  pronto = true;
}

// Usado só nos testes, para simular um banco novo.
export function esquecerBanco() {
  pronto = false;
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
