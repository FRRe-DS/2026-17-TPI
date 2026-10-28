# Imágenes del panel, del M6 simulado (spec 071, RNF-04.6) y del puente a la base (spec 072, RNF-04.8). Se construyen desde la raíz del repositorio, con
# `docker compose --profile panel up -d --build --wait`. Mismas reglas que el Dockerfile de M2 (RNF-04.1 a RNF-04.3): la misma
# imagen base con versión exacta en todas las etapas, instalación según el lockfile y sin scripts, y el usuario `node`.
FROM node:24.22.0-trixie-slim AS construccion
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY contrato ./contrato
COPY panel ./panel
# `npm run panel:build` genera los tipos del contrato, comprueba y compila el servidor y el M6 simulado a panel/dist/ y compila el
# cliente con Vite a panel/dist/cliente.
RUN npm run panel:build

FROM node:24.22.0-trixie-slim AS produccion
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Exactamente según el lockfile y solo lo de producción. `--ignore-scripts` impide que una dependencia corra scripts al instalarse.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# El M6 simulado usa la configuración, los errores y la regla de Host del servidor del panel.
COPY --from=construccion /app/panel/dist/servidor ./panel/dist/servidor
COPY --from=construccion /app/panel/dist/m6-simulado ./panel/dist/m6-simulado
USER node

# El M6 simulado: la API de m6.yml y su canal de control. Forma exec, para que la señal de parada llegue a Node (RNF-04.5).
FROM produccion AS m6-simulado
CMD ["node", "panel/dist/m6-simulado/main.js"]

# El panel: el servidor, que sirve el cliente compilado y le habla a M2 y al canal de control.
FROM produccion AS panel
COPY --from=construccion /app/panel/dist/cliente ./panel/dist/cliente
CMD ["node", "panel/dist/servidor/main.js"]

# El puente a la base: un reenvío TCP de ~70 líneas sin dependencias. El perfil `panel` lo publica en 127.0.0.1 para que el panel,
# cuando corre en la máquina, llegue a PostgreSQL sin publicar el puerto de `bd`. No necesita el servidor ni el cliente del panel.
FROM produccion AS puente-bd
COPY --from=construccion /app/panel/dist/puente-bd ./panel/dist/puente-bd
CMD ["node", "panel/dist/puente-bd/main.js"]
