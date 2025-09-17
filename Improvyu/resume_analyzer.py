# --- Import necessary libraries ---
from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import os
import json
import PyPDF2
import google.generativeai as genai

# --- Configuration & AI Model Initialization ---
API_KEY = os.getenv('GOOGLE_API_KEY')
model = None

def initialize_gemini():
    """Initializes the Gemini model."""
    global model
    if not API_KEY:
        print("WARNING: GOOGLE_API_KEY environment variable is not set. The application will not work.")
        return False
    try:
        print("Configuring Gemini API...")
        genai.configure(api_key=API_KEY)
        print("Initializing Gemini model...")
        model = genai.GenerativeModel('gemini-1.5-flash')
        print("Gemini model initialized successfully.")
        return True
    except Exception as e:
        print("======================================================================")
        print("FATAL ERROR: Could not initialize the Gemini model.")
        print(f"Specific Error Details: {e}")
        print("======================================================================")
        return False

if initialize_gemini() is False:
    exit()

def parse_resume(file_path):
    """Extracts the full raw text from an uploaded PDF file."""
    try:
        with open(file_path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            text = "".join(page.extract_text() for page in reader.pages if page.extract_text())
        if not text.strip():
            raise ValueError("PDF parsing resulted in empty text. The PDF might be an image.")
        return {"text": text}
    except Exception as e:
        print(f"Error parsing PDF file at {file_path}: {e}")
        raise Exception(f"Failed to read PDF content: {e}")

def generate_questions(resume_data):
    """Generates the initial set of interview questions."""
    if not model: raise Exception("Cannot generate questions: Gemini model not initialized.")
    if not resume_data or not resume_data.get("text"): raise ValueError("No resume text provided.")

    prompt = f"""
    Analyze the following resume and generate 5 insightful, open-ended interview questions.
    Return the result as a valid JSON array of strings.

    Resume Text:
    ---
    {resume_data['text']}
    ---
    """
    try:
        response = model.generate_content(prompt)
        # Find the JSON part of the response and parse it
        json_text = response.text.split('```json')[1].split('```')[0].strip()
        questions = json.loads(json_text)
        return questions
    except (IndexError, json.JSONDecodeError, Exception) as e:
        print(f"Error processing AI response for questions: {e}\nResponse was:\n{response.text}")
        raise Exception("The AI model returned an invalid format for questions.")

def generate_follow_up_question(history):
    """Generates a conversational follow-up question."""
    if not model: raise Exception("Cannot generate follow-up: Gemini model not initialized.")

    formatted_history = "\n".join([f"{item['role']}: {item['parts'][0]['text']}" for item in history])
    prompt = f"""
    You are an AI interviewer. Based on the conversation history below, ask a relevant follow-up question.
    If the topic seems concluded, respond with only the exact string "[NEXT_QUESTION]".
    Keep the question concise.

    History:
    ---
    {formatted_history}
    ---
    """
    try:
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"Error generating follow-up from AI: {e}")
        return "[NEXT_QUESTION]"

def generate_report(answers):
    """Generates a final performance report."""
    if not model: raise Exception("Cannot generate report: Gemini model not initialized.")
    if not answers: return {}

    answers_formatted = "\n".join([f"Answer {i+1}: {ans}" for i, ans in enumerate(answers)])
    prompt = f"""
    You are an expert career coach. Analyze the following interview answers and provide a report
    as a valid JSON object with keys: "overallScore" (a number out of 10), "strengths" (a paragraph), "weaknesses" (a paragraph), "suggestion" (a paragraph).

    Answers:
    ---
    {answers_formatted}
    ---
    """
    try:
        response = model.generate_content(prompt)
        json_text = response.text.split('```json')[1].split('```')[0].strip()
        report = json.loads(json_text)
        return report
    except (IndexError, json.JSONDecodeError, Exception) as e:
        print(f"Error processing AI response for report: {e}\nResponse was:\n{response.text}")
        raise Exception("The AI model returned an invalid format for the report.")

# --- Web Page Routes ---
@app.route('/')
def serve_landing_page():
    """Serves the main landing page (index.html)."""
    return send_from_directory('.', 'index.html')

@app.route('/interview.html')
def serve_interview_page():
    """Serves the interactive interview application page."""
    return send_from_directory('.', 'interview.html')

# --- API Endpoints ---
@app.route('/api/analyze', methods=['POST'])
def analyze_resume_api():
    """API endpoint for analyzing an uploaded resume."""
    if 'resume' not in request.files: return jsonify({"error": "No resume file part"}), 400
    file = request.files['resume']
    if file.filename == '': return jsonify({"error": "No file selected"}), 400

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        try:
            resume_data = parse_resume(file_path)
            questions = generate_questions(resume_data)
            os.remove(file_path)
            return jsonify({"questions": questions})
        except Exception as e:
            if os.path.exists(file_path): os.remove(file_path)
            return jsonify({"error": str(e)}), 500
    return jsonify({"error": "Invalid file type"}), 400

@app.route('/api/follow-up', methods=['POST'])
def follow_up_api():
    """API endpoint for generating a conversational follow-up question."""
    data = request.get_json()
    if not data or 'history' not in data: return jsonify({"error": "Missing history"}), 400
    try:
        question = generate_follow_up_question(data['history'])
        return jsonify({"question": question})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/evaluate', methods=['POST'])
def evaluate_answers_api():
    """API endpoint for generating the final interview report."""
    data = request.get_json()
    if not data or 'answers' not in data: return jsonify({"error": "Missing answers"}), 400
    try:
        report = generate_report(data['answers'])
        return jsonify(report)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Server Execution ---
if __name__ == '__main__':
    # For deploying on a platform like Render:
    # Your Start Command should be: gunicorn server:app
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))