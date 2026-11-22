// Anamnese do autocadastro: perguntas objetivas, de tocar, para o personal conhecer o aluno.
// A parte de saúde segue a lógica do PAR-Q (prontidão para atividade física) e só é guardada com consentimento.
// O mesmo roteiro serve a tela do convite (que recebe esta lista pela API) e a validação no servidor.

// tipo: um (uma opção) | varios (várias, com "max" opcional) | simnao
// detalhe: campo extra que aparece quando a resposta inclui uma das opções em "quando".
// mostrarSe: a pergunta só aparece quando outra tem a resposta indicada.
// {personal} vira o primeiro nome do personal na tela.
export const ANAMNESE = [
  {
    etapa: 'Seus objetivos',
    perguntas: [
      {
        id: 'objetivos',
        texto: 'Quais são seus objetivos com o treino?',
        ajuda: 'Marque quantos quiser.',
        tipo: 'varios',
        opcoes: [
          'Emagrecer',
          'Ganhar massa muscular',
          'Definir o corpo',
          'Melhorar o condicionamento',
          'Saúde e qualidade de vida',
          'Reduzir dores',
          'Performance no esporte',
          'Me preparar para um evento (prova, casamento, viagem)',
        ],
      },
      {
        id: 'meta',
        texto: 'Daqui a 12 meses, o que você quer ter conquistado?',
        tipo: 'um',
        opcoes: ['Perder peso', 'Ficar mais forte', 'Completar uma prova (5 km, 10 km ou outra)', 'Treinar com constância', 'Acabar com uma dor', 'Me sentir mais disposto'],
        detalhe: { quando: ['Perder peso'], rotulo: 'Quantos kg, mais ou menos? (opcional)', tipo: 'numero', min: 1, max: 150 },
      },
    ],
  },
  {
    etapa: 'Histórico e rotina',
    perguntas: [
      {
        id: 'experiencia',
        texto: 'Qual sua experiência com treino?',
        tipo: 'um',
        opcoes: ['Nunca treinei', 'Parado há mais de 1 ano', 'Parado há menos de 1 ano', 'Treino há menos de 6 meses', 'Treino de 6 meses a 2 anos', 'Treino há mais de 2 anos sem parar'],
      },
      {
        id: 'atividades',
        texto: 'Faz outras atividades físicas?',
        tipo: 'varios',
        opcoes: ['Nenhuma', 'Caminhada ou corrida', 'Bike', 'Natação', 'Crossfit', 'Luta', 'Esporte coletivo', 'Pilates ou yoga', 'Dança', 'Outra'],
        detalhe: { quando: ['Outra'], rotulo: 'Qual atividade?', tipo: 'texto', obrigatorio: true },
      },
      { id: 'frequencia', texto: 'Quantas vezes por semana você consegue treinar?', tipo: 'um', opcoes: ['1', '2', '3', '4', '5 ou mais'] },
      {
        id: 'trabalho',
        texto: 'Como é o seu trabalho?',
        tipo: 'um',
        opcoes: ['Sentado quase o dia todo', 'Em pé a maior parte do tempo', 'Esforço físico pesado', 'Em turnos ou à noite', 'Varia muito'],
      },
      { id: 'sono', texto: 'Quantas horas você dorme por noite?', tipo: 'um', opcoes: ['Menos de 6 h', '6 a 7 h', '7 a 8 h', 'Mais de 8 h'] },
      { id: 'descanso', texto: 'Você acorda descansado?', tipo: 'um', opcoes: ['Quase sempre', 'Às vezes', 'Quase nunca'] },
      { id: 'estresse', texto: 'Como está seu nível de estresse hoje?', tipo: 'um', opcoes: ['Baixo', 'Moderado', 'Alto'] },
    ],
  },
  {
    etapa: 'Saúde',
    saude: true,
    perguntas: [
      {
        id: 'lesao',
        texto: 'Tem alguma lesão, dor ou já fez cirurgia?',
        tipo: 'simnao',
        detalhe: { quando: ['Sim'], rotulo: 'Descreva: onde é, quando aconteceu e se faz tratamento', tipo: 'texto', obrigatorio: true },
      },
      {
        id: 'condicoes',
        texto: 'Tem alguma destas condições de saúde?',
        ajuda: 'Marque todas que se aplicam.',
        tipo: 'varios',
        opcoes: ['Nenhuma', 'Pressão alta', 'Diabetes', 'Problema no coração', 'Asma ou problema respiratório', 'Colesterol alto', 'Tireoide', 'Gestante ou pós-parto', 'Outra'],
        detalhe: { quando: ['Outra'], rotulo: 'Qual condição?', tipo: 'texto', obrigatorio: true },
      },
      { id: 'sinais', texto: 'Já sentiu dor no peito, tontura, desmaio ou falta de ar fora do normal ao fazer esforço?', tipo: 'simnao' },
      {
        id: 'remedio',
        texto: 'Usa algum remédio de uso contínuo?',
        tipo: 'simnao',
        detalhe: { quando: ['Sim'], rotulo: 'Qual remédio?', tipo: 'texto', obrigatorio: true },
      },
      { id: 'liberacao', texto: 'Tem liberação médica para atividade física?', tipo: 'um', opcoes: ['Tenho', 'Não tenho', 'Meu médico pediu cautela'] },
    ],
  },
  {
    etapa: 'Seu jeito',
    perguntas: [
      { id: 'personalidade', texto: 'No dia a dia, você é:', tipo: 'um', opcoes: ['Mais reservado', 'Equilibrado', 'Comunicativo, adoro conversar'] },
      { id: 'conversa', texto: 'Durante o treino, você prefere:', tipo: 'um', opcoes: ['Foco total, pouca conversa', 'Conversa nos intervalos', 'Papo o treino todo'] },
      {
        id: 'motivacao',
        texto: 'O que mais te motiva no treino?',
        ajuda: 'Escolha até 2.',
        tipo: 'varios',
        max: 2,
        opcoes: ['Ser desafiado', 'Ver números evoluindo (carga, medidas)', 'Elogio e incentivo', 'Entender o porquê de cada exercício', 'Treino variado', 'Leveza e diversão'],
      },
      { id: 'aperta', texto: 'Quando o treino aperta, você prefere que {personal}:', tipo: 'um', opcoes: ['Cobre firme', 'Incentive com calma', 'Ajuste o exercício na hora'] },
      { id: 'previsivel', texto: 'Treino previsível ou surpresa?', tipo: 'um', opcoes: ['Gosto de saber antes', 'Tanto faz', 'Adoro surpresas'] },
      {
        id: 'faltas',
        texto: 'O que mais te faz faltar ou desistir?',
        ajuda: 'Escolha até 2.',
        tipo: 'varios',
        max: 2,
        opcoes: ['Trabalho ou falta de tempo', 'Cansaço', 'Desânimo', 'Dor', 'Viagens', 'Família ou filhos', 'Chuva ou frio', 'Nada, sou constante'],
      },
    ],
  },
  {
    etapa: 'As aulas',
    perguntas: [
      {
        id: 'importante',
        texto: 'O que é mais importante numa aula para você?',
        ajuda: 'Escolha até 2.',
        tipo: 'varios',
        max: 2,
        opcoes: ['Pontualidade', 'Atenção total do personal', 'Explicação técnica', 'Treino intenso', 'Ambiente leve', 'Acompanhar minha evolução'],
      },
      { id: 'jaTreina', texto: 'Você já treina com {personal}?', tipo: 'simnao' },
      {
        id: 'melhorar',
        texto: 'O que {personal} poderia melhorar?',
        ajuda: 'Marque quantos quiser.',
        tipo: 'varios',
        mostrarSe: { id: 'jaTreina', valor: 'Sim' },
        opcoes: ['Mais variedade', 'Mais intensidade', 'Menos intensidade', 'Mais explicação', 'Mais acompanhamento da evolução', 'Mais pontualidade', 'Está ótimo assim'],
        detalhe: { quando: '*', rotulo: 'Quer contar mais? (opcional)', tipo: 'texto', obrigatorio: false },
      },
    ],
  },
];

const PERGUNTAS = ANAMNESE.flatMap((e) => e.perguntas.map((p) => ({ ...p, saude: !!e.saude })));
const MAX_TEXTO = 400;

const detalheAtivo = (p, valor) => {
  if (!p.detalhe || valor == null || (Array.isArray(valor) && !valor.length)) return false;
  if (p.detalhe.quando === '*') return true;
  const escolhidos = Array.isArray(valor) ? valor : [valor];
  return escolhidos.some((v) => p.detalhe.quando.includes(v));
};

const visivel = (p, respostas) => !p.mostrarSe || respostas[p.mostrarSe.id] === p.mostrarSe.valor;

// Confere e limpa as respostas. Lança Error com a mensagem para o aluno.
// Saída: { respostas, detalhes, saude: boolean, respondidaEm }. Sem consentimento, nada de saúde é guardado.
export function validarAnamnese(d) {
  if (!d || typeof d !== 'object') throw new Error('Responda as perguntas sobre você.');
  const entrada = d.respostas && typeof d.respostas === 'object' ? d.respostas : {};
  const detalhesEntrada = d.detalhes && typeof d.detalhes === 'object' ? d.detalhes : {};
  const pularSaude = !!d.pularSaude;
  if (!pularSaude && !d.consentimentoSaude) throw new Error('Para guardar as respostas de saúde, marque a autorização. Se preferir, pule essa etapa.');
  const respostas = {};
  const detalhes = {};
  for (const p of PERGUNTAS) {
    if (p.saude && pularSaude) continue;
    if (!visivel(p, respostas)) continue;
    const v = entrada[p.id];
    const titulo = p.texto.replace('{personal}', 'o personal');
    if (p.tipo === 'um' || p.tipo === 'simnao') {
      const opcoes = p.tipo === 'simnao' ? ['Sim', 'Não'] : p.opcoes;
      if (!opcoes.includes(v)) throw new Error(`Responda: ${titulo}`);
      respostas[p.id] = v;
    } else {
      const lista = Array.isArray(v) ? [...new Set(v.filter((x) => p.opcoes.includes(x)))] : [];
      if (!lista.length) throw new Error(`Responda: ${titulo}`);
      if (p.max && lista.length > p.max) throw new Error(`Escolha no máximo ${p.max}: ${titulo}`);
      // "Nenhuma", "Está ótimo assim" e afins não combinam com as outras opções.
      const exclusiva = lista.find((x) => ['Nenhuma', 'Está ótimo assim', 'Nada, sou constante'].includes(x));
      respostas[p.id] = exclusiva && lista.length > 1 ? lista.filter((x) => x !== exclusiva) : lista;
    }
    if (detalheAtivo(p, respostas[p.id])) {
      const bruto = detalhesEntrada[p.id];
      if (p.detalhe.tipo === 'numero') {
        const n = Number(bruto);
        if (bruto !== '' && bruto != null && Number.isFinite(n) && n >= p.detalhe.min && n <= p.detalhe.max) detalhes[p.id] = Math.round(n);
      } else {
        const t = String(bruto || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXTO);
        if (t) detalhes[p.id] = t;
        else if (p.detalhe.obrigatorio) throw new Error(`Preencha: ${p.detalhe.rotulo}`);
      }
    }
  }
  return { respostas, detalhes, saude: !pularSaude, respondidaEm: new Date().toISOString() };
}

// Para o personal: alertas de saúde (em vermelho) e um resumo de uma linha.
export function lerAnamnese(texto) {
  if (!texto) return null;
  let a;
  try {
    a = JSON.parse(texto);
  } catch {
    return null;
  }
  const r = a.respostas || {};
  const det = a.detalhes || {};
  const alertas = [];
  if (r.sinais === 'Sim') alertas.push('Sentiu dor no peito, tontura, desmaio ou falta de ar ao fazer esforço: peça liberação médica antes de treinos intensos.');
  if (r.liberacao === 'Meu médico pediu cautela') alertas.push('O médico pediu cautela com a atividade física.');
  if (r.lesao === 'Sim') alertas.push(`Lesão, dor ou cirurgia: ${det.lesao || 'sem descrição'}`);
  const condicoes = (r.condicoes || []).filter((c) => c !== 'Nenhuma').map((c) => (c === 'Outra' ? det.condicoes || 'Outra' : c));
  if (condicoes.length) alertas.push(`Condições de saúde: ${condicoes.join(', ')}.`);
  if (r.remedio === 'Sim') alertas.push(`Remédio de uso contínuo: ${det.remedio || 'não informado'}.`);
  const resumo = [
    (r.objetivos || []).slice(0, 2).join(' e '),
    r.frequencia && `${r.frequencia}x por semana`,
    r.personalidade,
    r.conversa,
    (r.motivacao || []).length && `motivado por ${r.motivacao.join(' e ').toLowerCase()}`,
  ].filter(Boolean).join(' · ');
  return { respondidaEm: a.respondidaEm, saude: !!a.saude, alertas, resumo };
}

// Respostas completas, em ordem e com o texto das perguntas, para a ficha do aluno.
export function itensDaAnamnese(texto, nomePersonal = 'o personal') {
  if (!texto) return null;
  let a;
  try {
    a = JSON.parse(texto);
  } catch {
    return null;
  }
  const r = a.respostas || {};
  const det = a.detalhes || {};
  const etapas = [];
  for (const bloco of ANAMNESE) {
    if (bloco.saude && !a.saude) {
      etapas.push({ etapa: bloco.etapa, itens: [{ pergunta: 'Saúde', resposta: 'O aluno preferiu não responder.' }] });
      continue;
    }
    const itens = bloco.perguntas
      .filter((p) => r[p.id] != null)
      .map((p) => {
        let resposta = Array.isArray(r[p.id]) ? r[p.id].join(', ') : r[p.id];
        if (det[p.id] != null) resposta += p.detalhe?.tipo === 'numero' ? ` (${det[p.id]} kg)` : `: ${det[p.id]}`;
        return { pergunta: p.texto.replaceAll('{personal}', nomePersonal), resposta };
      });
    if (itens.length) etapas.push({ etapa: bloco.etapa, itens });
  }
  return { respondidaEm: a.respondidaEm, etapas };
}
