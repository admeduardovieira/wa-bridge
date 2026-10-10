name: Bug Report

about: Report a bug or issue with wa-bridge
title: '[bug] '
labels: bug
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting a bug! Please fill out the information below.
        Make sure to check existing issues first: https://github.com/admeduardovieira/wa-bridge/issues

  - type: textarea
    id: description
    attributes:
      label: Description
      description: A clear and concise description of the bug.
    validations:
      required: true

  - type: textarea
    id: reproduction
    attributes:
      label: Reproduction steps
      description: |
        Steps to reproduce the behavior.
        1. ...
        2. ...
        3. ...
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      description: What did you expect to happen?
    validations:
      required: true)

  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
      description: What actually happened?
    validations:
      required: true

  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: |
        - OS:
        - Node.js version:
        - wa-bridge version:
        - LLM provider:
      value: |
        - OS:
        - Node.js version:
        - wa-bridge version:
        - LLM provider:
    validations:
      required: true

  - type: textarea
    id: logs
    attributes:
      label: Logs
      description: Any relevant log output.
      placeholder: Paste logs here (remove any sensitive data)
    validations:
      required: false
