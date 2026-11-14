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

O app roda como um **Worker** conectado a este repositório do GitHub.
O arquivo `wrangler.jsonc` já declara tudo: a pasta `public/`, o banco D1 (`DB`) e a IA (`AI`).
Na publicação, a Cloudflare cria o banco e liga a IA sozinha, e as tabelas são criadas no primeiro acesso.

Cada alteração enviada ao GitHub é publicada automaticamente.

Opcional: a variável `AI_MODEL` troca o modelo de IA (o padrão é `@cf/meta/llama-3.1-8b-instruct`).

## Estrutura

- `public/`: telas (convite, aluno, painel) em HTML, CSS e JavaScript puro, sem etapa de build.
- `src/`: servidor (Cloudflare Workers). A entrada é `src/worker.js` e a API fica em `src/api.js`.
- `lib/`: regras da jornada (meses, selos, sequência), geração do Pix e estrutura do banco.
- `testes/`: testes automáticos e um servidor local com banco em memória.

## Testar no computador

Requer Node.js 22 ou mais novo. Não há dependências para instalar.

```
npm test                        # roda os testes
node testes/servidor-local.js   # abre o app em http://localhost:8788
```

## Recuperação de senha

Não há envio de e-mail. Ao criar a conta, o personal recebe um código de recuperação (mostrado uma vez).
Em "Esqueci minha senha", ele informa e-mail, código e a senha nova. Um novo código pode ser gerado na aba Conta.
Quem perder a senha e o código precisa de ajuste direto no banco.
