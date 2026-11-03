# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine
# The official nginx image renders /etc/nginx/templates/*.template with envsubst at startup.
ENV SUWAYOMI_URL=http://suwayomi:4567
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
