import { Button, Icon } from '@blueprintjs/core'
import { AxiosInstance } from 'axios'
import { WorkspaceUserWithAttributes } from 'botpress/sdk'
import { MoreOptions } from 'botpress/shared'
import React, { FC, useState } from 'react'
import style from '../../style.scss'
import CreateAgentModal from './CreateAgentModal'
import InfoModal from './InfoModal'
import ManageAgentsModal from './ManageAgentsModal'
interface Props {
  bp: { axios: AxiosInstance; events: any }
  agents: WorkspaceUserWithAttributes[]
  disabled: boolean
}

const SupervisorMenu: FC<Props> = ({ bp, agents, disabled }) => {
  const [display, setDisplay] = useState(false)
  const [createAgentModalOpen, setCreateAgentModalOpen] = useState(false)
  const [manageAgentsModalOpen, setManageAgentsModalOpen] = useState(false)
  const [infoModalOpen, setInfoModalOpen] = useState(false)
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [messageId, setMessageId] = useState<any>()

  const optionsItems = [
    {
      label: 'Create new agent',
      action: () => {
        setCreateAgentModalOpen(true)
      }
    },
    {
      label: 'Manage agents',
      action: () => {
        setManageAgentsModalOpen(true)
      }
    }
  ]

  const onAgentCreated = createdUser => {
    setMessageId('newAccount')
    setCreateAgentModalOpen(false)
    setInfoModalOpen(true)
    setEmail(createdUser.email)
    setPassword(createdUser.tempPassword)
  }
  const onPasswordReset = (email, password) => {
    setMessageId('passwordReset')
    setEmail(email)
    setPassword(password)
    setInfoModalOpen(true)
    setManageAgentsModalOpen(false)
  }
  const onAgentRemoved = () => {
    setMessageId('agentRemoved')
    setManageAgentsModalOpen(false)
  }

  return (
    <div className={style.agentBtnWrapper} hidden={disabled}>
      <CreateAgentModal
        bp={bp}
        onAgentCreated={onAgentCreated}
        isOpen={createAgentModalOpen}
        toggleOpen={() => setCreateAgentModalOpen(!createAgentModalOpen)}
      />
      <ManageAgentsModal
        bp={bp}
        filteredAgents={agents}
        isOpen={manageAgentsModalOpen}
        toggleOpen={() => setManageAgentsModalOpen(!manageAgentsModalOpen)}
        onPasswordReset={onPasswordReset}
        onAgentRemoved={onAgentRemoved}
      />
      <InfoModal
        isOpen={infoModalOpen}
        toggleOpen={() => setInfoModalOpen(!infoModalOpen)}
        email={email}
        tempPassword={password}
      />
      <MoreOptions
        element={
          <Button className={style.agentBtn} onClick={() => setDisplay(true)} minimal={true}>
            <span className={style.agentBtnText}>Supervisor Menu</span>
            <Icon icon="chevron-down"></Icon>
          </Button>
        }
        show={display}
        onToggle={() => setDisplay(false)}
        items={optionsItems}
      />
    </div>
  )
}

export default SupervisorMenu
