FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build

FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-auth.sh /docker-entrypoint.d/40-auth.sh
RUN chmod +x /docker-entrypoint.d/40-auth.sh
COPY --from=build /app/dist/dashboard-executivo/browser /usr/share/nginx/html
EXPOSE 80
