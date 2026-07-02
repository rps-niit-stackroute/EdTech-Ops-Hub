# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
WORKDIR /app

ENV NODE_ENV=production

# Enable Yarn 1.x via Corepack
RUN corepack enable && corepack prepare yarn@1.22.22 --activate

# Copy dependency manifests first for better caching
COPY package.json yarn.lock* ./
RUN yarn install --production=false --network-timeout 600000

# Copy source and build the app
COPY . .
ARG REACT_APP_BACKEND_URL=http://localhost:5000
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL
RUN yarn build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

RUN npm install -g serve && addgroup -S app && adduser -S -G app app

COPY --from=builder /app/build ./build
RUN chown -R app:app /app

USER app
EXPOSE 3000

CMD ["serve", "-s", "build", "-l", "3000"]
