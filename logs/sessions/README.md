# Session Logs

This directory contains JSONL session logs for the RAG Memory System ETL pipeline.

Each file contains one session's worth of agent steps in JSONL format (one JSON object per line).

File naming: session_<timestamp>_<random>.jsonl

These logs are consumed by the pentest-rag-memory ETL pipeline to extract anti-patterns and playbooks.
