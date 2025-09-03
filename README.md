# SanNext

Funções serverless e front-end para a fila virtual SuaVez.

## Funcionalidades

### Para Clientes
- Entrar ou desistir da fila pelo smartphone.
- Verificar senha de acesso e silenciar alertas.
- Ativar notificações sonoras quando a chamada inicia.

### Para Atendentes
- Painel de controle da fila com botões de Próximo, Próximo Preferencial, Repetir, Atendido e Ticket manual.
- Opções administrativas como redefinir cadastro, espelhar monitor, editar horário, clonar atendente e trocar senha.
- Geração de relatórios e exportação em PDF ou Excel.

## Vantagens para o usuário/cliente
- Evita filas presenciais: o cliente entra na fila pelo celular e acompanha o número chamado.
- Controle total sobre a participação: pode cancelar a qualquer momento ou silenciar alertas.
- Atendimento mais ágil graças ao painel de gestão do atendente, reduzindo o tempo de espera.

## Reset de Monitor

A função `deleteMonitorConfig` apaga o registro do monitor e **todas** as chaves `tenant:{token}:*` associadas no Redis.
Esse reset remove contadores, senha, label, tickets e logs, utilizando `SCAN`/`DEL` para eliminar também conjuntos e hashes da fila.

Após o reset, todos os links do monitor e do cliente ficam inválidos e nenhum dado da fila é preservado..
