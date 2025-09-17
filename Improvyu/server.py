# server.py

# --- Import necessary libraries ---
from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
import os
import json
import re
import PyPDF2
import google.generativeai as genai

# --- Load Environment Variables ---
# Make sure you have a .env file with your GOOGLE_API_KEY
load_dotenv()

# --- Configuration & AI Model Initialization ---
API_KEY = os.getenv('GOOGLE_API_KEY')
model = None

def initialize_gemini():
    """Initializes the Gemini model. Returns True on success, False on failure."""
    global model
    if not API_KEY:
        print("FATAL ERROR: GOOGLE_API_KEY environment variable is not set.")
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

# --- Flask App Initial Setup ---
app = Flask(__name__, static_folder='.', static_url_path='')
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    """A helper function to check if an uploaded file has the allowed .pdf extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- AI-Powered Logic Functions ---

def parse_resume(file_path):
    """Extracts the full raw text from an uploaded PDF file."""
    try:
        with open(file_path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            text = "".join(page.extract_text() for page in reader.pages if page.extract_text())
        if not text.strip():
            raise ValueError("PDF parsing resulted in empty text. The PDF might be an image or corrupted.")
        return {"text": text}
    except Exception as e:
        print(f"Error parsing PDF file at {file_path}: {e}")
        raise Exception(f"Failed to read PDF content: {e}")

def generate_questions(resume_data):
    """Generates the initial set of interview questions."""
    if not model: raise Exception("Cannot generate questions: Gemini model not initialized.")
    if not resume_data or not resume_data.get("text"): raise ValueError("No resume text provided.")

    prompt = f"""
    Analyze the following resume and generate exactly 5 insightful, open-ended interview questions
    that would be effective for screening this candidate. The questions should be diverse and cover
    technical skills, past projects, and behavioral aspects mentioned in the resume.

    Return the result as a valid JSON array of strings. Example: ["Question 1", "Question 2"]

    Resume Text:
    ---
    {resume_data['text']}
    ---
    """
    try:
        response = model.generate_content(prompt)
        match = re.search(r"```json\s*([\s\S]*?)\s*```", response.text)
        if not match:
             # Fallback if the model doesn't use markdown
             clean_text = response.text.strip()
             if clean_text.startswith('[') and clean_text.endswith(']'):
                 questions = json.loads(clean_text)
                 return questions
             else:
                raise ValueError("No valid JSON array found in the AI response.")
        json_text = match.group(1).strip()
        questions = json.loads(json_text)
        return questions
    except (json.JSONDecodeError, Exception) as e:
        print(f"Error processing AI response for questions: {e}\nResponse was:\n{response.text}")
        raise Exception("The AI model returned an invalid format for questions.")

def generate_follow_up_question(history):
    """Generates a conversational follow-up question."""
    if not model: raise Exception("Cannot generate follow-up: Gemini model not initialized.")
    
    formatted_history = "\n".join([f"{item['role']}: {item['parts'][0]['text']}" for item in history])
    prompt = f"""
    You are an AI interviewer. Based on the conversation history below, ask a relevant and concise follow-up question.
    Your goal is to dig deeper into the candidate's last answer.

    If the candidate's last answer seems complete and you have no more to ask on that topic,
    respond with only the exact string "[NEXT_QUESTION]". Do not add any other text.

    History:
    ---
    {formatted_history}
    ---
    Follow-up Question or command:
    """
    try:
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"Error generating follow-up from AI: {e}")
        return "[NEXT_QUESTION]" # Failsafe

def generate_report(answers):
    """Generates a final performance report."""
    if not model: raise Exception("Cannot generate report: Gemini model not initialized.")
    if not answers: return {}

    answers_formatted = "\n".join([f"- {ans}" for ans in answers])
    prompt = f"""
    You are an expert career coach and hiring manager. Analyze the following interview answers and provide a
    constructive performance report. The report should be a valid JSON object with the following keys:
    "overallScore" (a number out of 10),
    "strengths" (a paragraph identifying positive aspects like clarity, specific examples, and confidence),
    "weaknesses" (a paragraph identifying areas for improvement like vagueness, lack of detail, or poor structure),
    "suggestion" (a paragraph with a single, actionable suggestion for the candidate to improve their interviewing skills).

    Answers provided by the candidate:
    ---
    {answers_formatted}
    ---
    """
    try:
        response = model.generate_content(prompt)
        match = re.search(r"```json\s*([\s\S]*?)\s*```", response.text)
        if not match:
            raise ValueError("No valid JSON object found in the AI response.")
        json_text = match.group(1).strip()
        report = json.loads(json_text)
        return report
    except (json.JSONDecodeError, Exception) as e:
        print(f"Error processing AI response for report: {e}\nResponse was:\n{response.text}")
        raise Exception("The AI model returned an invalid format for the report.")

# --- Web Page Routes ---
@app.route('/')
def serve_landing_page():
    """Serves the main landing page (assuming you have an index.html)."""
    return send_from_directory('.', 'index.html')

@app.route('/interview.html')
def serve_interview_page():
    """Serves the interactive interview application page."""
    return send_from_directory('.', 'interview.html')

# --- API Endpoints ---
@app.route('/api/analyze', methods=['POST'])
def analyze_resume_api():
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
            return jsonify({"questions": questions})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        finally:
            if os.path.exists(file_path):
                os.remove(file_path) # Clean up the uploaded file
    return jsonify({"error": "Invalid file type. Please upload a PDF."}), 400

@app.route('/api/follow-up', methods=['POST'])
def follow_up_api():
    data = request.get_json()
    if not data or 'history' not in data: return jsonify({"error": "Missing history"}), 400
    try:
        question = generate_follow_up_question(data['history'])
        return jsonify({"question": question})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/evaluate', methods=['POST'])
def evaluate_answers_api():
    data = request.get_json()
    if not data or 'answers' not in data: return jsonify({"error": "Missing answers"}), 400
    try:
        report = generate_report(data['answers'])
        return jsonify(report)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Server Execution ---
if __name__ == '__main__':
    if not initialize_gemini():
        exit(1) # Exit if the AI model fails to initialize
    
    # For local development:
    app.run(host='0.0.0.0', port=5000, debug=True)
    # For deploying on a platform like Render, your Start Command should be: gunicorn "server:app"