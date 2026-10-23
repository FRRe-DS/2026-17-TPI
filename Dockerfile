# Imagen del servicio (RNF-04.1 a RNF-04.3). La misma imagen base en las dos etapas, con versión exacta.
FROM node:24.22.0-trixie-slim AS construccion
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY contrato ./contrato
COPY src ./src
# `npm run build` genera los tipos del contrato (prebuild) y compila a dist/.
RUN npm run build

FROM node:24.22.0-trixie-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Exactamente según el lockfile y solo lo de producción. `--ignore-scripts` impide que una dependencia corra scripts al instalarse.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=construccion /app/dist ./dist
COPY --from=construccion /app/contrato ./contrato
COPY migraciones ./migraciones
USER node
# Forma exec, para que la señal de parada llegue a Node (RNF-04.5).
CMD ["node", "dist/servidor.js"]
