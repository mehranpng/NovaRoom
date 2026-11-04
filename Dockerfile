FROM node:22-alpine AS frontend-builder

WORKDIR /app/front-end

COPY front-end/package*.json ./
RUN npm ci

COPY front-end/ ./

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /etc/nginx/sites-enabled/* /etc/nginx/sites-available/* /var/www/html/*

COPY back-end/requirements.txt ./back-end/
RUN pip install --no-cache-dir -r back-end/requirements.txt

COPY back-end/ ./back-end/
RUN mkdir -p /app/back-end/uploads

COPY --from=frontend-builder /app/front-end/dist /usr/share/nginx/html

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
