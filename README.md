# Renova.AI

Renovação de mensalidade para personal trainers, sem cara de cobrança.
O aluno acompanha uma trilha de meses de treino, desbloqueia cada mês por Pix e compartilha a conquista.
O personal acompanha tudo em um painel e envia lembretes pelo próprio WhatsApp.

## Como funciona

- **Personal:** cria a conta em `/painel`, cadastra a chave Pix e envia o link de convite (`/c/seu-link`).
- **Aluno:** se cadastra pelo convite com nome e WhatsApp e ganha um link pessoal (`/a/código`), sem senha.
- **Renovação:** o app monta o Pix copia e cola com o valor. O aluno paga direto ao personal e toca em "Já paguei"; o personal confirma no painel.
- **Lembretes:** o painel abre o WhatsApp do personal com a mensagem pronta para cada aluno.
- **IA:** sugere frases para a arte e reescreve o lembrete. O personal sempre aprova antes.

Não há provedor de pagamento nem envio automático de mensagens: o custo de operação é zero.

## Publicar na Cloudflare (gratuito)

Os nomes dos menus podem variar um pouco no painel da Cloudflare.

1. **Criar o site:** em *Workers & Pages*, crie um projeto **Pages** conectado a este repositório do GitHub.
   - Framework: nenhum
   - Comando de build: deixe vazio
   - Diretório de saída: `public`
2. **Criar o banco:** em *Storage & Databases > D1*, crie um banco chamado `renova-ai`.
3. **Ligar o banco e a IA ao site:** no projeto Pages, em *Settings > Bindings*, adicione:
   - um binding **D1 database** com o nome `DB`, apontando para o banco `renova-ai`;
   - um binding **Workers AI** com o nome `AI`.
4. **Publicar de novo:** em *Deployments*, refaça a última publicação para os bindings valerem.

As tabelas do banco são criadas sozinhas no primeiro acesso. Depois disso, cada alteração enviada ao GitHub é publicada automaticamente.

Opcional: a variável `AI_MODEL` troca o modelo de IA (o padrão é `@cf/meta/llama-3.1-8b-instruct`).

## Estrutura

- `public/`: telas (convite, aluno, painel) em HTML, CSS e JavaScript puro, sem etapa de build.
- `functions/`: servidor (Cloudflare Pages Functions). A API fica em `functions/api/[[rota]].js`.
- `lib/`: regras da jornada (meses, selos, sequência), geração do Pix e estrutura do banco.
- `testes/`: testes automáticos e um servidor local com banco em memória.

## Testar no computador

Requer Node.js 22 ou mais novo. Não há dependências para instalar.

```
npm test                        # roda os testes
node testes/servidor-local.js   # abre o app em http://localhost:8788
```

## Antes de divulgar

- Troque o contato em `public/privacidade.html`.
- Não existe recuperação de senha ainda: quem esquecer precisa de ajuste direto no banco.
