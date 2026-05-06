import subprocess
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

def guardar_lista_ficheiros():
    nome_ficheiro_saida = PROJECT_ROOT / "lista_ficheiros.txt"
    print(f"A compilar a lista de ficheiros em: {PROJECT_ROOT}...")
    
    try:
        # Ficheiros já monitorizados pelo Git
        tracked = subprocess.check_output(
            ['git', 'ls-files'], 
            text=True,
            cwd=PROJECT_ROOT,
        ).splitlines()
        
        # Ficheiros novos (untracked) mas filtrados pelo .gitignore
        untracked = subprocess.check_output(
            ['git', 'ls-files', '--others', '--exclude-standard'], 
            text=True,
            cwd=PROJECT_ROOT,
        ).splitlines()

        # Junta as duas listas e remove potenciais duplicados
        todos_ficheiros = sorted(set(tracked + untracked))

        if not todos_ficheiros:
            print("Nenhum ficheiro encontrado.")
            return

        caminho_base = PROJECT_ROOT
        contador = 0
        
        # Abre (ou cria) o ficheiro de texto para escrita
        with open(nome_ficheiro_saida, 'w', encoding='utf-8') as ficheiro_txt:
            for ficheiro in todos_ficheiros:
                # Bloqueio extra: Ignora qualquer caminho que comece ou contenha a pasta .venv
                # (Lida com barras normais de Linux/Mac e barras invertidas de Windows)
                if ficheiro.startswith('.venv/') or '/.venv/' in ficheiro or ficheiro.startswith('.venv\\') or '\\.venv\\' in ficheiro:
                    continue
                
                caminho_absoluto = os.path.normpath(os.path.join(caminho_base, ficheiro))
                
                # Escreve o caminho no ficheiro com uma quebra de linha
                ficheiro_txt.write(caminho_absoluto + '\n')
                contador += 1
                
        print("-" * 50)
        print(f"✓ Sucesso! Foram guardados {contador} ficheiros no documento '{nome_ficheiro_saida}'.")

    except subprocess.CalledProcessError:
        print("Erro: Este diretório não parece ser um repositório Git válido.")
    except FileNotFoundError:
        print("Erro: O comando 'git' não está instalado ou não está no PATH.")

if __name__ == "__main__":
    guardar_lista_ficheiros()
