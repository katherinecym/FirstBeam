.PHONY: setup run lint eval

setup:
	@echo "Creating virtual environment..."
	python3 -m venv .venv
	@echo "Installing dependencies..."
	.venv/bin/pip install -r requirements.txt


run:
	@echo "Running Lighthouse Concierge Server (Backend & Frontend) on http://127.0.0.1:7040 ..."
	.venv/bin/uvicorn app.fast_api_app:app --host 127.0.0.1 --port 7040 --reload --env-file .env

lint:
	@echo "Running lint check..."
	.venv/bin/agents-cli lint

eval:
	@echo "Running evaluations..."
	.venv/bin/python -m app.eval
