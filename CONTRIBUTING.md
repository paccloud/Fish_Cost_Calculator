# Contributing to Scale & Cost

Thank you for your interest in contributing! This document provides guidelines for contributing to the Fish Cost Calculator project.

## Ways to Contribute

### 1. Report Bugs

- Open a GitHub issue with the `bug` label
- Include steps to reproduce, expected behavior, and actual behavior
- Include browser/OS information if relevant

### 2. Suggest Features

- Open a GitHub issue with the `enhancement` label
- Describe the use case and how it would benefit users

### 3. Add Yield Data

We're always looking to expand our species database. To contribute yield data:

1. **Source your data** - It must come from a reputable source (scientific studies, NOAA, state fisheries agencies)
2. **Format your data** - Follow the structure in `app/src/data/fish_data_v3.js`:
   ```javascript
   "Species Name": {
     scientific_name: "Genus species",
     category: "Category",
     conversions: {
       "Round → D/H-On": { yield: 88, range: [82, 94] },
       // ... more conversions
     }
   }
   ```
3. **Cite your source** - All data must include attribution
4. **Submit a PR** - Include the source in your PR description

### 4. Improve Documentation

- Fix typos, improve clarity, add examples
- Translate documentation to other languages

### 5. Code Contributions

#### Getting Started

```bash
# Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/Fish_Cost_Calculator.git

# Create a feature branch
git checkout -b feature/your-feature-name

# Make your changes and test locally
cd app && npm install && npm run dev
cd ../server && npm install && node server.js
```

#### Code Standards

- Use consistent indentation (2 spaces)
- Write descriptive commit messages
- Add comments for complex logic
- Test your changes before submitting

#### Pull Request Process

1. Update documentation if needed
2. Ensure the app runs without errors
3. Create a PR with a clear description of changes
4. Wait for review

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Remember we're all here to support the fishing community

## Questions?

Open an issue with the `question` label or reach out to the maintainers.
