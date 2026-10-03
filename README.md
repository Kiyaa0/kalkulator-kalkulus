# CalcKu (Calculus & Linear Algebra Calculator)

CalcKu is a secure, optimized, modular web-based calculator designed to solve advanced Calculus and Linear Algebra problems. Built with Python and Flask, it processes symbolic mathematical expressions and provides analytical results along with graphical visualizations.

## Features

- Derivatives: Calculate derivatives of any order and evaluate them at specific points.
- Integrals: Compute both indefinite and definite integrals with given boundaries.
- Limits: Find the mathematical limit of a function at a specific point, supporting left, right, or two-sided limits.
- Natural Domain Analysis: Determine the valid domain for rational, radical, and logarithmic functions.
- Matrix Operations: Perform various matrix calculations including addition, scalar multiplication, and Elementary Row Operations.
- Visualizations: Automatic generation of PNG and SVG plots for mathematical functions.

## Technology Stack

- Backend: Flask
- Symbolic Mathematics Engine: SymPy
- Plotting and Visualization: Matplotlib
- Scientific Computing: NumPy
- Production Server: Gunicorn

## Security and Performance

This application is designed to be production-ready and includes several built-in optimizations:
- Custom Rate Limiting: Built-in rate limiter to prevent abuse and API spamming.
- Timeout Protection: Heavy mathematical computations are executed in separate threads with strict timeouts to prevent server locking.
- HTTP Security: Strict Content-Security-Policy (CSP) headers, XSS protection, and payload size limitations.

## Installation and Setup

1. Clone the repository and navigate to the project directory:
   ```bash
   git clone <repository-url>
   cd kalkulator-kalkulus
   ```

2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```

3. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Run the application (Development):
   ```bash
   flask run --port=5050
   ```
   Or run using Gunicorn (Production):
   ```bash
   gunicorn -c gunicorn.conf.py app:app
   ```

## API Endpoints

The application exposes the following REST API endpoints. All endpoints expect `application/json` payloads.

- `POST /api/turunan` - Calculate derivative
- `POST /api/integral` - Calculate integral
- `POST /api/limit` - Calculate limit
- `POST /api/natural-domain` - Analyze function domain
- `POST /api/matrix` - Perform matrix operations
