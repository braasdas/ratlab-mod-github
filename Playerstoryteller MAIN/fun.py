import os
import sys
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
import time
from collections import defaultdict
import math
import mimetypes
import datetime

# --- Configuration & Theme ---
class Theme:
    """Defines the color palette and styling for the application."""
    BG_DARK = "#1e1e2e"       # Main Window Background
    BG_PANEL = "#252535"      # Panel/Card Background
    ACCENT = "#89b4fa"        # Primary Action Color (Blue)
    ACCENT_HOVER = "#b4befe"
    TEXT_MAIN = "#cdd6f4"     # Primary Text
    TEXT_DIM = "#a6adc8"      # Secondary Text
    SUCCESS = "#a6e3a1"       # Green
    WARNING = "#f9e2af"       # Yellow
    ERROR = "#f38ba8"         # Red
    
    # Language Colors for the Chart
    LANG_COLORS = {
        "Python": "#3572A5",
        "JavaScript": "#f1e05a",
        "HTML": "#e34c26",
        "CSS": "#563d7c",
        "Java": "#b07219",
        "C++": "#f34b7d",
        "C": "#555555",
        "C#": "#178600",
        "TypeScript": "#2b7489",
        "Ruby": "#701516",
        "Go": "#00ADD8",
        "Rust": "#dea584",
        "PHP": "#4F5D95",
        "JSON": "#292929",
        "Markdown": "#083fa1",
        "SQL": "#e38c00",
        "Shell": "#89e051",
        "Other": "#6e7681"
    }
    
    FONT_HEADER = ("Segoe UI", 24, "bold")
    FONT_SUBHEADER = ("Segoe UI", 16, "bold")
    FONT_BODY = ("Segoe UI", 11)
    FONT_SMALL = ("Segoe UI", 9)
    FONT_MONO = ("Consolas", 10)

# --- Logic & Scanner ---
class CodeScanner:
    """Handles the file system traversing and parsing."""
    
    IGNORE_DIRS = {'.git', '__pycache__', 'node_modules', 'venv', '.idea', '.vscode', 'build', 'dist', 'bin', 'obj'}
    EXT_MAP = {
        '.py': 'Python', '.pyw': 'Python',
        '.js': 'JavaScript', '.jsx': 'JavaScript',
        '.html': 'HTML', '.htm': 'HTML',
        '.css': 'CSS', '.scss': 'CSS',
        '.java': 'Java',
        '.cpp': 'C++', '.cc': 'C++', '.h': 'C++', '.hpp': 'C++',
        '.c': 'C',
        '.cs': 'C#',
        '.ts': 'TypeScript', '.tsx': 'TypeScript',
        '.rb': 'Ruby',
        '.go': 'Go',
        '.rs': 'Rust',
        '.php': 'PHP',
        '.json': 'JSON',
        '.md': 'Markdown',
        '.sql': 'SQL',
        '.sh': 'Shell', '.bash': 'Shell'
    }

    def __init__(self):
        self.stats = {
            'total_files': 0,
            'total_lines': 0,
            'total_chars': 0,
            'languages': defaultdict(int), # Lang -> Lines
            'file_counts': defaultdict(int), # Lang -> File Count
            'imports': 0,
            'largest_file': {'name': 'None', 'lines': 0, 'path': ''},
            'start_time': 0,
            'end_time': 0,
            'earliest_file_date': float('inf'),
            'latest_file_date': 0
        }

    def scan(self, directory, progress_callback):
        self.stats['start_time'] = time.time()
        
        # Reset
        self.stats['total_files'] = 0
        self.stats['total_lines'] = 0
        self.stats['total_chars'] = 0
        self.stats['languages'].clear()
        self.stats['file_counts'].clear()
        self.stats['imports'] = 0
        self.stats['largest_file'] = {'name': 'None', 'lines': 0, 'path': ''}
        self.stats['earliest_file_date'] = float('inf')
        self.stats['latest_file_date'] = 0

        total_files_to_scan = 0
        # Pre-pass to count files for progress bar
        for root, dirs, files in os.walk(directory):
            dirs[:] = [d for d in dirs if d not in self.IGNORE_DIRS]
            total_files_to_scan += len(files)

        processed = 0

        for root, dirs, files in os.walk(directory):
            # Modify dirs in-place to skip ignored directories
            dirs[:] = [d for d in dirs if d not in self.IGNORE_DIRS]
            
            for file in files:
                file_path = os.path.join(root, file)
                ext = os.path.splitext(file)[1].lower()
                
                if ext in self.EXT_MAP:
                    lang = self.EXT_MAP[ext]
                    try:
                        # File Stats (Timestamps)
                        file_stats = os.stat(file_path)
                        # Use min of ctime/mtime for creation proxy, mtime for latest work
                        c_time = file_stats.st_ctime
                        m_time = file_stats.st_mtime
                        
                        if c_time < self.stats['earliest_file_date']:
                            self.stats['earliest_file_date'] = c_time
                        if m_time < self.stats['earliest_file_date']: # check mtime too just in case
                            self.stats['earliest_file_date'] = m_time
                            
                        if m_time > self.stats['latest_file_date']:
                            self.stats['latest_file_date'] = m_time

                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            lines = content.splitlines()
                            line_count = len(lines)
                            char_count = len(content)
                            
                            # Update Stats
                            self.stats['total_files'] += 1
                            self.stats['total_lines'] += line_count
                            self.stats['total_chars'] += char_count
                            self.stats['languages'][lang] += line_count
                            self.stats['file_counts'][lang] += 1
                            
                            # Check for largest file
                            if line_count > self.stats['largest_file']['lines']:
                                self.stats['largest_file'] = {
                                    'name': file, 
                                    'lines': line_count,
                                    'path': file_path
                                }

                            # Fun Fact: Count imports (very naive regex-less approach for speed)
                            for line in lines:
                                l = line.strip()
                                if l.startswith('import ') or l.startswith('#include') or l.startswith('require') or l.startswith('using '):
                                    self.stats['imports'] += 1

                    except Exception as e:
                        # Skip files we can't read
                        pass
                
                processed += 1
                if processed % 10 == 0: # Update UI every 10 files
                    progress_callback(processed, total_files_to_scan)

        self.stats['end_time'] = time.time()
        return self.stats

# --- Custom Widgets ---
class DonutChart(tk.Canvas):
    """A custom widget to draw a donut chart of language usage."""
    def __init__(self, parent, width=300, height=300, bg=Theme.BG_PANEL):
        super().__init__(parent, width=width, height=height, bg=bg, highlightthickness=0)
        self.width = width
        self.height = height

    def draw(self, data):
        """Data is a dictionary of Label -> Value"""
        self.delete("all")
        
        total = sum(data.values())
        if total == 0:
            self.create_text(self.width/2, self.height/2, text="No Data", fill=Theme.TEXT_DIM, font=Theme.FONT_SUBHEADER)
            return

        # Sort data by value
        sorted_data = dict(sorted(data.items(), key=lambda item: item[1], reverse=True))
        
        start_angle = 90
        center_x, center_y = self.width / 2, self.height / 2
        radius = min(self.width, self.height) / 2 - 20
        width = 40 # Donut thickness

        # Draw segments
        for label, value in sorted_data.items():
            extent = (value / total) * 360
            color = Theme.LANG_COLORS.get(label, Theme.LANG_COLORS["Other"])
            
            # tkinter arc extent is counter-clockwise, start is also ccw from 3 o'clock
            # We want to start from 12 o'clock (90 degrees) and go clockwise (negative extent)
            
            if extent > 0:
                self.create_arc(
                    center_x - radius, center_y - radius,
                    center_x + radius, center_y + radius,
                    start=start_angle, extent=extent,
                    fill=color, outline=Theme.BG_PANEL, width=2, style=tk.PIESLICE
                )
                start_angle += extent

        # Draw center circle to make it a donut
        self.create_oval(
            center_x - (radius - width), center_y - (radius - width),
            center_x + (radius - width), center_y + (radius - width),
            fill=Theme.BG_PANEL, outline=""
        )
        
        # Center Text
        self.create_text(center_x, center_y - 10, text="TOP LANGUAGE", fill=Theme.TEXT_DIM, font=("Segoe UI", 8, "bold"))
        top_lang = list(sorted_data.keys())[0]
        self.create_text(center_x, center_y + 15, text=top_lang, fill=Theme.TEXT_MAIN, font=("Segoe UI", 14, "bold"))

class StatCard(tk.Frame):
    """A polished card widget for displaying a single statistic."""
    def __init__(self, parent, title, value, icon=""):
        super().__init__(parent, bg=Theme.BG_PANEL, padx=20, pady=20)
        self.grid_columnconfigure(0, weight=1)
        
        self.lbl_title = tk.Label(self, text=title.upper(), font=("Segoe UI", 9, "bold"), fg=Theme.TEXT_DIM, bg=Theme.BG_PANEL, anchor="w")
        self.lbl_title.pack(fill="x")
        
        self.lbl_value = tk.Label(self, text=value, font=("Segoe UI", 22, "bold"), fg=Theme.ACCENT, bg=Theme.BG_PANEL, anchor="w")
        self.lbl_value.pack(fill="x", pady=(5, 0))

    def update_value(self, new_value):
        self.lbl_value.config(text=new_value)

class FunFactCard(tk.Frame):
    """Displays generated insights."""
    def __init__(self, parent):
        super().__init__(parent, bg=Theme.BG_PANEL, padx=20, pady=20)
        tk.Label(self, text="INSIGHTS & FUN FACTS", font=("Segoe UI", 12, "bold"), fg=Theme.TEXT_MAIN, bg=Theme.BG_PANEL).pack(anchor="w", pady=(0, 10))
        self.text_area = tk.Text(self, bg=Theme.BG_PANEL, fg=Theme.TEXT_DIM, font=Theme.FONT_BODY, bd=0, highlightthickness=0, height=8, wrap="word")
        self.text_area.pack(fill="both", expand=True)
        self.text_area.insert("1.0", "Scan a directory to see facts here...")
        self.text_area.config(state="disabled")

    def set_facts(self, facts_list):
        self.text_area.config(state="normal")
        self.text_area.delete("1.0", "end")
        for fact in facts_list:
            self.text_area.insert("end", f"• {fact}\n\n")
        self.text_area.config(state="disabled")

# --- Main Application ---
class CodeScopeApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("CodeScope Analyzer")
        self.geometry("1100x700")
        self.configure(bg=Theme.BG_DARK)
        
        # Determine icon (optional, fail silently)
        try:
            # self.iconbitmap("icon.ico") # If you have one
            pass
        except:
            pass

        self.scanner = CodeScanner()
        self.current_dir = tk.StringVar(value="No Directory Selected")
        
        self._setup_styles()
        self._build_ui()
        
    def _setup_styles(self):
        style = ttk.Style()
        style.theme_use('clam')
        
        # Frame
        style.configure('TFrame', background=Theme.BG_DARK)
        
        # Buttons
        style.configure('Accent.TButton', 
                       font=Theme.FONT_BODY, 
                       background=Theme.ACCENT, 
                       foreground=Theme.BG_DARK,
                       borderwidth=0, 
                       focuscolor=Theme.ACCENT)
        style.map('Accent.TButton', background=[('active', Theme.ACCENT_HOVER)])
        
        # Progress Bar
        style.configure("Horizontal.TProgressbar", 
                        background=Theme.ACCENT, 
                        troughcolor=Theme.BG_PANEL, 
                        thickness=5)

    def _build_ui(self):
        # --- Sidebar ---
        sidebar = tk.Frame(self, bg=Theme.BG_PANEL, width=250, padx=20, pady=20)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        # App Logo / Title
        tk.Label(sidebar, text="CodeScope", font=Theme.FONT_HEADER, fg=Theme.TEXT_MAIN, bg=Theme.BG_PANEL).pack(anchor="w")
        tk.Label(sidebar, text="v1.0.0", font=Theme.FONT_SMALL, fg=Theme.TEXT_DIM, bg=Theme.BG_PANEL).pack(anchor="w")

        tk.Frame(sidebar, height=40, bg=Theme.BG_PANEL).pack() # Spacer

        # Controls
        tk.Label(sidebar, text="SCOPE", font=("Segoe UI", 10, "bold"), fg=Theme.TEXT_DIM, bg=Theme.BG_PANEL).pack(anchor="w", pady=(0, 5))
        
        self.btn_select = ttk.Button(sidebar, text="Select Folder", style="Accent.TButton", command=self.select_directory)
        self.btn_select.pack(fill="x", pady=5)
        
        self.lbl_path = tk.Label(sidebar, textvariable=self.current_dir, font=("Segoe UI", 9), fg=Theme.TEXT_DIM, bg=Theme.BG_PANEL, wraplength=210, justify="left")
        self.lbl_path.pack(fill="x", pady=5)

        tk.Frame(sidebar, height=20, bg=Theme.BG_PANEL).pack() # Spacer

        self.btn_scan = ttk.Button(sidebar, text="Run Analysis", style="Accent.TButton", command=self.start_scan)
        self.btn_scan.pack(fill="x", pady=5)
        self.btn_scan.state(['disabled']) # Disabled until folder selected

        # Status Footer
        self.status_lbl = tk.Label(sidebar, text="Ready", font=("Segoe UI", 9), fg=Theme.SUCCESS, bg=Theme.BG_PANEL, anchor="w")
        self.status_lbl.pack(side="bottom", fill="x")
        
        self.progress = ttk.Progressbar(sidebar, style="Horizontal.TProgressbar", orient="horizontal", mode="determinate")
        self.progress.pack(side="bottom", fill="x", pady=(0, 10))

        # --- Main Content Area ---
        content = tk.Frame(self, bg=Theme.BG_DARK, padx=30, pady=30)
        content.pack(side="right", fill="both", expand=True)

        # Header
        header_frame = tk.Frame(content, bg=Theme.BG_DARK)
        header_frame.pack(fill="x", pady=(0, 20))
        tk.Label(header_frame, text="Dashboard Overview", font=Theme.FONT_SUBHEADER, fg=Theme.TEXT_MAIN, bg=Theme.BG_DARK).pack(side="left")

        # Top Stats Row
        stats_frame = tk.Frame(content, bg=Theme.BG_DARK)
        stats_frame.pack(fill="x", pady=(0, 20))
        stats_frame.grid_columnconfigure(0, weight=1)
        stats_frame.grid_columnconfigure(1, weight=1)
        stats_frame.grid_columnconfigure(2, weight=1)

        self.card_lines = StatCard(stats_frame, "Total Lines of Code", "0")
        self.card_lines.grid(row=0, column=0, sticky="ew", padx=(0, 10))
        
        self.card_files = StatCard(stats_frame, "Files Scanned", "0")
        self.card_files.grid(row=0, column=1, sticky="ew", padx=10)
        
        self.card_lang = StatCard(stats_frame, "Primary Language", "-")
        self.card_lang.grid(row=0, column=2, sticky="ew", padx=(10, 0))

        # Middle Section (Chart + Fun Facts)
        mid_frame = tk.Frame(content, bg=Theme.BG_DARK)
        mid_frame.pack(fill="both", expand=True)
        mid_frame.grid_columnconfigure(0, weight=3) # Chart area
        mid_frame.grid_columnconfigure(1, weight=2) # Facts area
        mid_frame.grid_rowconfigure(0, weight=1)    # Ensure both panels expand vertically

        # Chart Container
        chart_container = tk.Frame(mid_frame, bg=Theme.BG_PANEL, padx=20, pady=20)
        chart_container.grid(row=0, column=0, sticky="nsew", padx=(0, 10))
        
        tk.Label(chart_container, text="LANGUAGE DISTRIBUTION", font=("Segoe UI", 12, "bold"), fg=Theme.TEXT_MAIN, bg=Theme.BG_PANEL).pack(anchor="w")
        
        self.donut = DonutChart(chart_container, width=350, height=350)
        self.donut.pack(expand=True)
        
        # Legend Frame (Inside Chart Container)
        self.legend_frame = tk.Frame(chart_container, bg=Theme.BG_PANEL)
        self.legend_frame.pack(pady=10) # Removed fill="x" to center the legend items

        # Fun Facts Container
        self.facts_card = FunFactCard(mid_frame)
        self.facts_card.grid(row=0, column=1, sticky="nsew", padx=(10, 0))

    def select_directory(self):
        path = filedialog.askdirectory()
        if path:
            self.current_dir.set(path)
            self.btn_scan.state(['!disabled'])
            self.status_lbl.config(text="Directory selected", fg=Theme.TEXT_MAIN)

    def start_scan(self):
        path = self.current_dir.get()
        if not path or path == "No Directory Selected":
            return
            
        self.btn_scan.state(['disabled'])
        self.btn_select.state(['disabled'])
        self.status_lbl.config(text="Scanning...", fg=Theme.WARNING)
        self.progress['value'] = 0
        
        # Run in thread
        thread = threading.Thread(target=self._run_scan_thread, args=(path,))
        thread.daemon = True
        thread.start()

    def _run_scan_thread(self, path):
        # Progress callback to update UI from thread
        def update_progress(current, total):
            if total > 0:
                prog = (current / total) * 100
                self.after(0, lambda: self.progress.configure(value=prog))

        results = self.scanner.scan(path, update_progress)
        self.after(0, lambda: self.show_results(results))

    def show_results(self, stats):
        # Re-enable buttons
        self.btn_scan.state(['!disabled'])
        self.btn_select.state(['!disabled'])
        self.progress['value'] = 100
        self.status_lbl.config(text="Analysis Complete", fg=Theme.SUCCESS)

        # Update Top Cards
        self.card_lines.update_value(f"{stats['total_lines']:,}")
        self.card_files.update_value(f"{stats['total_files']:,}")
        
        top_lang = "None"
        if stats['languages']:
            top_lang = max(stats['languages'], key=stats['languages'].get)
        self.card_lang.update_value(top_lang)

        # Draw Chart
        self.donut.draw(stats['languages'])
        
        # Update Legend
        for widget in self.legend_frame.winfo_children():
            widget.destroy()
            
        # Show top 4 languages in legend
        sorted_langs = sorted(stats['languages'].items(), key=lambda x: x[1], reverse=True)[:4]
        for lang, count in sorted_langs:
            row = tk.Frame(self.legend_frame, bg=Theme.BG_PANEL)
            row.pack(side="left", padx=10)
            
            color = Theme.LANG_COLORS.get(lang, Theme.LANG_COLORS["Other"])
            canvas = tk.Canvas(row, width=12, height=12, bg=Theme.BG_PANEL, highlightthickness=0)
            canvas.create_oval(0, 0, 10, 10, fill=color, outline="")
            canvas.pack(side="left", padx=(0, 5))
            
            tk.Label(row, text=lang, fg=Theme.TEXT_DIM, bg=Theme.BG_PANEL, font=("Segoe UI", 9)).pack(side="left")

        # Generate Fun Facts
        facts = []
        
        # 1. Project Lifespan
        if stats['earliest_file_date'] != float('inf') and stats['latest_file_date'] > 0:
            diff_seconds = stats['latest_file_date'] - stats['earliest_file_date']
            if diff_seconds > 0:
                days = int(diff_seconds // 86400)
                hours = int((diff_seconds % 86400) // 3600)
                
                start_date_str = datetime.datetime.fromtimestamp(stats['earliest_file_date']).strftime('%Y-%m-%d')
                facts.append(f"⏱️ **Time Travel:** This project spans approx. {days} days and {hours} hours (since {start_date_str}).")
        
        # 2. Largest File
        if stats['largest_file']['name'] != 'None':
            facts.append(f"📦 **Heavy Lifter:** The largest file is '{stats['largest_file']['name']}' with {stats['largest_file']['lines']:,} lines.")
            
        # 3. Coffee Calculation
        coffee_cups = math.ceil(stats['total_lines'] / 150)
        facts.append(f"☕ **Fuel Required:** This project was powered by approximately {coffee_cups:,} cups of coffee.")
        
        # 4. Paper Stack
        pages = math.ceil(stats['total_lines'] / 60)
        height_mm = pages * 0.1
        height_m = height_mm / 1000
        facts.append(f"📄 **Tree Killer:** If printed, this code would span {pages:,} pages and stack {height_m:.2f} meters high.")
        
        # 5. Marathon Fingers
        # Average laptop key travel ~1.5mm. Desktops ~4mm. Let's average to 3mm.
        # Total distance = (chars * 3mm) / 1000 (to meters)
        distance_m = (stats['total_chars'] * 3) / 1000
        facts.append(f"🏃 **Marathon Fingers:** Typing this code involved key travel distance of approx. {distance_m:,.2f} meters.")

        # 6. Novel Equivalent
        # Average novel is ~90,000 words. 
        # Approx words in code (very rough) = chars / 5
        words = stats['total_chars'] / 5
        novels = words / 90000
        facts.append(f"📚 **Book Worm:** You've written the equivalent of {novels:.1f} average-length novels.")

        self.facts_card.set_facts(facts)

if __name__ == "__main__":
    app = CodeScopeApp()
    app.mainloop()