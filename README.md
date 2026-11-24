# Hiro IA — NIPPON-AJI

Demo de conversação publicada em https://hiro-nippon-teste.vercel.app/.

O código da interface, das duas funções de API, da logo e de `vercel.json` foi exportado diretamente do deployment em produção e conferido por hash. A migração para este repositório preserva o código publicado. O manifesto em `docs/deployed-source.json` registra os arquivos originais.

## Estrutura

- `index.html`, `chat.js`, `chat.css`: interface de conversa.
- `api/chat.mjs`: adaptador para os workflows existentes de atendimento, transcrição e voz do n8n.
- `api/purchase-verification.mjs`: fluxo existente de verificação de compras.
- `brand/`: logo usada no chat.
- `vercel.json`: configuração de funções e cabeçalhos.

## Vercel

Projeto existente: **hiro-nippon-teste**, na equipe **contato-4630s-projects**. A raiz de publicação é a raiz deste repositório, sem etapa de build. O runtime configurado no projeto existente é mantido.

As variáveis de ambiente continuam configuradas na Vercel. `.env.example` lista apenas seus nomes; os valores não fazem parte do repositório. O funcionamento do agente também depende dos workflows e das credenciais já configurados no n8n, que não são alterados por este projeto.

Para desenvolver localmente, use Node.js compatível com o runtime do projeto e a CLI da Vercel. Configure um `.env.local` a partir do exemplo e execute `vercel dev`. Não compartilhe as credenciais.

## Conferência básica

```sh
node --check chat.js
node --check api/chat.mjs
node --check api/purchase-verification.mjs
```

O vínculo com o GitHub permite que alterações futuras da branch `main` sejam publicadas pelo projeto existente. A conexão inicial é feita depois do envio deste snapshot, preservando o deployment que já estava no ar.

## Cards de produtos e prêmios

O adaptador preserva product_cards, presentation, text, demo e balance_points do workflow. Aceita o corpo direto ou um envelope n8n [{status, body}]. A tela mostra a introdução de text e cada card com image_url, name e unit_price em BRL; prêmios usam kind=reward e price_points/points. Um item aparece como card; dois ou três aparecem em carrossel com rolagem horizontal e navegação por teclado. Sem botões nos cards. reply mantém o resumo para contexto e fallback, sem repetir os preços na bolha. Produtos com imagem ausente ou falha no carregamento mostram Foto indisponível. As imagens Mobne estão autorizadas na CSP.

O workflow atualizado deve estar importado e ativo no n8n. O frontend não gera saldo nem prêmios de teste; exibe a simulação recebida do workflow com demo=true.
