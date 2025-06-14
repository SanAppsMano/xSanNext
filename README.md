# SanNext

Este projeto utiliza funções serverless e um front-end estático para gerenciar filas virtuais. Agora há suporte a notificações push para alertar clientes mesmo com o navegador em segundo plano.

## Variáveis de ambiente

Além das chaves já utilizadas para o Redis e outros serviços, são necessários dois valores para o envio das notificações:

- `VAPID_PUBLIC_KEY` – chave pública utilizada na assinatura das mensagens Web Push.
- `VAPID_PRIVATE_KEY` – chave privada correspondente.

As duas devem ser definidas no ambiente onde as funções serverless são executadas. A chave pública é disponibilizada ao cliente através da função `sendPush` para permitir a assinatura da inscrição.
