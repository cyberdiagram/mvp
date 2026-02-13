# Brain Container — Dev-Ready (deps only, source via bind mount)
#
# Source code is NOT baked in — it comes from the bind mount at runtime.
# Only needs rebuilding when package.json dependencies change.
FROM node:20-slim

WORKDIR /app

# Only copy dependency manifests + yalc packages for npm install
COPY package*.json ./
COPY .yalc/ ./.yalc/

# Install all dependencies (including devDependencies for tsc)
RUN npm install

# No COPY dist/ or src/ — bind mount provides live source code
# No CMD — docker-compose.yml provides: command: npm run dev
