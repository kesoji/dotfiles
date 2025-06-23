.PHONY: test
test:
	@echo "🧪 Running tests for create-obsidian-task..."
	@cd "$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))" && python -m pytest test_create_obsidian_task.py -v

.PHONY: test-quiet
test-quiet:
	@cd "$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))" && python -m pytest test_create_obsidian_task.py -q

.PHONY: help
help:
	@echo "Available targets:"
	@echo "  test       - Run tests with verbose output"
	@echo "  test-quiet - Run tests with minimal output"
	@echo "  help       - Show this help message"