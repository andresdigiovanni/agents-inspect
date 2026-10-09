.DEFAULT_GOAL := help
.PHONY: help install dev start build test lint check clean

help: ## Lista los targets disponibles
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{ printf "  make %-8s %s\n", $$1, $$2 }'

install: ## Instala las dependencias (npm ci)
	npm ci

dev: ## Arranca API (127.0.0.1:3001) y Vite (127.0.0.1:5173) en modo desarrollo
	npm run dev

start: ## Compila el frontend y sirve la app en 127.0.0.1:3001
	npm start

build: ## Compila el frontend en dist/
	npm run build

test: ## Ejecuta los tests
	npm test

lint: ## Typecheck (tsc) y ESLint
	npm run typecheck
	npm run lint

check: lint test build ## Todo lo que debe pasar antes de un commit

clean: ## Borra dist/
	rm -rf dist
