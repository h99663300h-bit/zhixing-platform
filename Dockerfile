FROM node:18-alpine
WORKDIR /app
COPY package.json ./
COPY . .
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "server.js"]
