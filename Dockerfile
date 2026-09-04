FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && apk add --no-cache postgresql-client
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
USER node
EXPOSE 3001
CMD ["node", "server/index.mjs"]
