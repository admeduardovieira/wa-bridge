name: Feature Request

about: Suggest a new feature or enhancement for wa-bridge
title: '[feature] '
labels: enhancement
body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting a feature! Please describe what you'd like to see.

  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What problem does this feature solve? What are you trying to do that's difficult or impossible?
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
      description: Describe the solution you'd like. Be specific.
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      description: What alternatives have you considered?
    validations:
      required: false

  - type: textarea
    id: context
    attributes:
      label: Additional context
      description: Add any other context, screenshots, or links here.
    validations:
      required: false