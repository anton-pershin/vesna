"""Interactive password-hash helper; passwords are never command arguments or echoed."""

import getpass

from .auth import hash_password


def main() -> None:
    password = getpass.getpass("New Vesna password: ")
    confirmation = getpass.getpass("Confirm Vesna password: ")
    if not password or password != confirmation:
        raise SystemExit("Passwords were empty or did not match; no hash was generated.")
    print(hash_password(password))


if __name__ == "__main__":
    main()
