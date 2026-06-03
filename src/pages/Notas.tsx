import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Color from '@tiptap/extension-color'
import TextStyle from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, List, ListOrdered, Highlighter, Type, Eraser, NotebookPen,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const NOTA_ID = '00000000-0000-0000-0000-000000000001'
const RED_COLOR = '#dc2626'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function Notas() {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [loaded, setLoaded] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debounceSave = useCallback((html: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      const { error } = await supabase.from('notas').upsert(
        { id: NOTA_ID, contenido: html, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      setSaveStatus(error ? 'error' : 'saved')
    }, 2000)
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({
        placeholder:
          'Escribe tus notas aquí... Usa rojo para urgentes y amarillo para pendientes importantes.',
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      debounceSave(editor.getHTML())
    },
  })

  useEffect(() => {
    if (!editor || loaded) return
    async function load() {
      const { data } = await supabase
        .from('notas')
        .select('contenido')
        .eq('id', NOTA_ID)
        .single()
      if (data?.contenido) {
        editor.commands.setContent(data.contenido)
      }
      setLoaded(true)
    }
    load()
  }, [editor, loaded])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  if (!editor) return null

  const btn = (active: boolean) =>
    `p-1.5 rounded transition-colors shrink-0 ${active ? 'bg-gray-600' : 'hover:bg-gray-700'}`

  const isRed = editor.isActive('textStyle', { color: RED_COLOR })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <NotebookPen size={20} className="text-gray-700" />
          Notas de trabajo
        </h2>
        <span
          className={`text-sm font-medium transition-colors ${
            saveStatus === 'saved'
              ? 'text-green-700'
              : saveStatus === 'error'
              ? 'text-red-600'
              : 'text-gray-400'
          }`}
        >
          {saveStatus === 'saving' && 'Guardando...'}
          {saveStatus === 'saved' && 'Guardado ✓'}
          {saveStatus === 'error' && 'Error al guardar ✗'}
        </span>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="bg-gray-800 px-2 py-2 flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={btn(editor.isActive('bold'))}
            title="Negrita"
          >
            <Bold size={15} className="text-white" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={btn(editor.isActive('italic'))}
            title="Cursiva"
          >
            <Italic size={15} className="text-white" />
          </button>

          <div className="w-px h-5 bg-gray-600 mx-1 shrink-0" />

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={btn(editor.isActive('bulletList'))}
            title="Lista con viñetas"
          >
            <List size={15} className="text-white" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={btn(editor.isActive('orderedList'))}
            title="Lista numerada"
          >
            <ListOrdered size={15} className="text-white" />
          </button>

          <div className="w-px h-5 bg-gray-600 mx-1 shrink-0" />

          <button
            type="button"
            onClick={() =>
              editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()
            }
            className={btn(editor.isActive('highlight', { color: '#fef08a' }))}
            title="Resaltar amarillo (pendientes)"
          >
            <Highlighter size={15} className="text-yellow-300" />
          </button>
          <button
            type="button"
            onClick={() =>
              isRed
                ? editor.chain().focus().unsetColor().run()
                : editor.chain().focus().setColor(RED_COLOR).run()
            }
            className={btn(isRed)}
            title="Texto rojo (urgente)"
          >
            <Type size={15} className="text-red-400" />
          </button>

          <div className="w-px h-5 bg-gray-600 mx-1 shrink-0" />

          <button
            type="button"
            onClick={() =>
              editor.chain().focus().unsetAllMarks().clearNodes().run()
            }
            className={btn(false)}
            title="Limpiar formato"
          >
            <Eraser size={15} className="text-white" />
          </button>
        </div>

        {/* Editor */}
        <div className="p-6 notas-editor">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
