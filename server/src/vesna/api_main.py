"""Console entry point for the public application API."""

import argparse

import uvicorn

from .api import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Vesna application API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    arguments = parser.parse_args()
    uvicorn.run(create_app(), host=arguments.host, port=arguments.port, proxy_headers=False)


if __name__ == "__main__":
    main()
